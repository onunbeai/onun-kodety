<?php

declare(strict_types=1);

namespace KodetyRocket\Cache;

use FilesystemIterator;
use JsonException;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;
use Throwable;

/**
 * Filesystem page-cache store with bounded reads and fail-open behavior.
 *
 * Layout:
 * wp-content/cache/kodety-rocket/{blog}/pages/{host-sha256}/{path-sha256}/{key-sha256}.html[.gz|.br]
 * Metadata is kept in a sibling *.meta.json file. All mutations use a
 * per-entry lock, a same-filesystem temporary file and an atomic rename.
 */
final class FileCacheStore
{
    private const ENCODINGS = ['identity', 'gzip', 'br'];
    private const MAX_METADATA_BYTES = 262144;
    private const STATS_SCAN_LIMIT = 100000;
    private const STATS_BUDGET_MS = 250;
    private const MAX_SITE_ROOTS = 10000;

    private string $baseDirectory;
    private mixed $logger = null;

    /** @var array<int, true> */
    private array $protectedSites = [];

    /** Result of the most recent full/site purge, independent of delete count. */
    private bool $lastPurgeSucceeded = true;

    /**
     * The first argument accepts either a logger/callable or a base-directory
     * string, keeping the class convenient in WordPress and isolated tests.
     */
    public function __construct(
        mixed $loggerOrBaseDirectory = null,
        ?string $baseDirectory = null,
        private int $lockTimeoutMs = 250,
        private int $maxEntryBytes = 16777216,
        private bool $writeGzip = true,
        private int $gzipLevel = 6,
        private int $maxSiteEntries = 5000,
        private int $maxSiteBytes = 536870912,
        private int $maintenanceScanLimit = 40000,
        private int $maintenanceBudgetMs = 75,
        private int $maxEvictionsPerWrite = 32,
    ) {
        if (is_string($loggerOrBaseDirectory) && $baseDirectory === null) {
            $baseDirectory = $loggerOrBaseDirectory;
        } elseif ($loggerOrBaseDirectory !== null) {
            $this->logger = $loggerOrBaseDirectory;
        }

        if ($lockTimeoutMs < 0 || $lockTimeoutMs > 10000) {
            throw new RuntimeException('Cache lock timeout must be between 0 and 10000 ms.');
        }
        if ($maxEntryBytes < 1024) {
            throw new RuntimeException('Maximum cache entry size is too small.');
        }
        if ($gzipLevel < -1 || $gzipLevel > 9) {
            throw new RuntimeException('Invalid gzip compression level.');
        }
        if ($maxSiteEntries < 1 || $maxSiteBytes < 1048576) {
            throw new RuntimeException('Invalid per-site cache quota.');
        }
        if ($maintenanceScanLimit < 100 || $maintenanceScanLimit > 1000000
            || $maintenanceBudgetMs < 1 || $maintenanceBudgetMs > 5000
            || $maxEvictionsPerWrite < 1 || $maxEvictionsPerWrite > 1000) {
            throw new RuntimeException('Invalid cache maintenance bounds.');
        }

        $this->baseDirectory = $this->normalizeBaseDirectory($baseDirectory ?? $this->defaultBaseDirectory());
    }

    public function baseDirectory(): string
    {
        return $this->baseDirectory;
    }

    /**
     * A purge deleting zero entries can mean either "already empty" or
     * "could not acquire the safety lock". Callers that invalidate content
     * need this separate status so a transient lock failure is never mistaken
     * for success.
     */
    public function lastPurgeSucceeded(): bool
    {
        return $this->lastPurgeSucceeded;
    }

    /**
     * Bounded, fail-open data for diagnostics/admin UI. When the file or time
     * budget is exhausted, returned totals are lower bounds and `truncated`
     * is true.
     *
     * @return array{entries:int,variants:int,bytes:int,base_directory:string,writable:bool,truncated:bool,scanned_files:int}
     */
    public function stats(?int $blogId = null): array
    {
        $fallback = [
            'entries' => 0,
            'variants' => 0,
            'bytes' => 0,
            'base_directory' => $this->baseDirectory,
            'writable' => $this->directoryIsWritable($this->baseDirectory),
            'truncated' => false,
            'scanned_files' => 0,
        ];

        try {
            if (! is_dir($this->baseDirectory)) {
                return $fallback;
            }

            $globalLock = $this->acquireLock($this->globalLockPath(), LOCK_SH, false);
            if ($globalLock === null) {
                $fallback['truncated'] = true;

                return $fallback;
            }

            try {
                $deadline = microtime(true) + (self::STATS_BUDGET_MS / 1000);
                $rootResult = $this->discoverPageRoots($blogId, $deadline, self::MAX_SITE_ROOTS);
                $remaining = max(0, self::STATS_SCAN_LIMIT - $rootResult['scanned']);
                $entries = 0;
                $variants = 0;
                $bytes = 0;
                $scanned = $rootResult['scanned'];
                $truncated = $rootResult['truncated'];

                foreach ($rootResult['roots'] as $root) {
                    if ($remaining < 1 || microtime(true) >= $deadline) {
                        $truncated = true;
                        break;
                    }

                    $result = $this->scanPageRoot($root, $remaining, $deadline, false);
                    $entries += count($result['entries']);
                    $variants += $result['variants'];
                    $bytes += $result['bytes'];
                    $scanned += $result['scanned'];
                    $remaining = max(0, $remaining - $result['scanned']);
                    $truncated = $truncated || $result['truncated'];
                }

                return [
                    'entries' => $entries,
                    'variants' => $variants,
                    'bytes' => $bytes,
                    'base_directory' => $this->baseDirectory,
                    'writable' => $this->directoryIsWritable($this->baseDirectory),
                    'truncated' => $truncated,
                    'scanned_files' => $scanned,
                ];
            } finally {
                $this->releaseLock($globalLock);
            }
        } catch (Throwable $error) {
            $fallback['truncated'] = true;
            $this->log('error', 'cache_stats_failed', ['error' => $error::class]);

            return $fallback;
        }
    }

    /**
     * Reads the preferred representation. An unavailable gzip/br variant
     * transparently falls back to identity; callers must use entry->encoding()
     * when emitting Content-Encoding.
     *
     * @param null|callable(): bool $readGuard Revalidated while the global
     *                                         shared lock is held.
     */
    public function get(CacheKey $key, string $encoding = 'identity', ?callable $readGuard = null): ?CacheEntry
    {
        try {
            if (! is_dir($this->baseDirectory)) {
                return null;
            }

            $globalLock = $this->acquireLock($this->globalLockPath(), LOCK_SH, false);
            if ($globalLock === null) {
                $this->log('warning', 'cache_read_lock_unavailable', ['key' => $key->hash()]);

                return null;
            }

            try {
                if ($readGuard !== null && !$readGuard()) {
                    return null;
                }

                $prefix = $this->entryPrefix($key);
                if (! is_dir(dirname($prefix))) {
                    return null;
                }

                $preferences = $this->encodingPreferences($encoding);
                if (! $this->hasAnyVariantFile($prefix, $preferences)) {
                    return null;
                }

                $entryLock = $this->acquireLock($prefix . '.lock', LOCK_SH, true);
                if ($entryLock === null) {
                    $this->log('warning', 'cache_entry_lock_unavailable', ['key' => $key->hash()]);

                    return null;
                }

                try {
                    foreach ($preferences as $candidate) {
                        $entry = $this->readVariant($prefix, $candidate, $key);
                        if ($entry !== null && $entry->isFresh()) {
                            return $entry;
                        }
                    }
                } finally {
                    $this->releaseLock($entryLock);
                }
            } finally {
                $this->releaseLock($globalLock);
            }
        } catch (Throwable $error) {
            $this->log('error', 'cache_read_failed', [
                'key' => $key->hash(),
                'error' => $error::class,
            ]);
        }

        return null;
    }

    /**
     * @param null|callable(): bool $writeGuard Revalidated while the global
     *                                          shared lock is held. This makes
     *                                          generation checks atomic with
     *                                          respect to a full purge.
     */
    public function put(CacheKey $key, CacheEntry $entry, ?callable $writeGuard = null): bool
    {
        try {
            if (! $entry->isSharedCacheable() || strlen($entry->body()) > $this->maxEntryBytes) {
                return false;
            }

            if (! $this->ensureDirectory($this->baseDirectory)) {
                return false;
            }

            $globalLock = $this->acquireLock($this->globalLockPath(), LOCK_SH, true);
            if ($globalLock === null) {
                $this->log('warning', 'cache_write_global_lock_unavailable', ['key' => $key->hash()]);

                return false;
            }

            try {
                if ($writeGuard !== null && !$writeGuard()) {
                    return false;
                }

                $prefix = $this->entryPrefix($key);
                $pagesDirectory = $this->siteDirectory($key->blogId());
                if (! $this->ensureDirectory($pagesDirectory)
                    || ! $this->ensurePageProtection($key->blogId())
                    || ! $this->ensureDirectory(dirname($prefix))) {
                    return false;
                }

                $existingBytes = $this->prefixBytes($prefix);
                $incomingBytes = $this->estimateEntryBytes($entry);
                $isNew = ! $this->prefixHasData($prefix);
                if (! $this->maintainSiteQuota(
                    $key->blogId(),
                    $prefix,
                    $incomingBytes - $existingBytes,
                    $isNew,
                )) {
                    $this->log('warning', 'cache_site_quota_unavailable', ['blog_id' => $key->blogId()]);

                    return false;
                }

                $entryLock = $this->acquireLock($prefix . '.lock', LOCK_EX, true);
                if ($entryLock === null) {
                    $this->log('warning', 'cache_write_lock_unavailable', ['key' => $key->hash()]);

                    return false;
                }

                try {
                    $written = $this->writeEntryVariants($prefix, $key, $entry);
                } finally {
                    $this->releaseLock($entryLock);
                }

                if ($written) {
                    // A second bounded pass closes races with concurrent writers.
                    $this->maintainSiteQuota($key->blogId(), $prefix, 0, false);
                }

                return $written;
            } finally {
                $this->releaseLock($globalLock);
            }
        } catch (Throwable $error) {
            $this->log('error', 'cache_write_failed', [
                'key' => $key->hash(),
                'error' => $error::class,
            ]);

            return false;
        }
    }

    /** @param null|callable(): bool $writeGuard */
    public function putAtomically(CacheKey $key, CacheEntry $entry, ?callable $writeGuard = null): bool
    {
        return $this->put($key, $entry, $writeGuard);
    }

    /**
     * Deletes all wire encodings for one exact logical key.
     */
    public function delete(CacheKey $key): bool
    {
        try {
            if (! is_dir($this->baseDirectory)) {
                return true;
            }

            $globalLock = $this->acquireLock($this->globalLockPath(), LOCK_SH, false);
            if ($globalLock === null) {
                return false;
            }

            try {
                $prefix = $this->entryPrefix($key);
                if (! is_dir(dirname($prefix))) {
                    return true;
                }

                $entryLock = $this->acquireLock($prefix . '.lock', LOCK_EX, true);
                if ($entryLock === null) {
                    return false;
                }

                try {
                    return $this->deletePrefix($prefix);
                } finally {
                    $this->releaseLock($entryLock);
                }
            } finally {
                $this->releaseLock($globalLock);
            }
        } catch (Throwable $error) {
            $this->log('error', 'cache_delete_failed', [
                'key' => $key->hash(),
                'error' => $error::class,
            ]);

            return false;
        }
    }

    /**
     * Purges every logical variant of one canonical URL.
     *
     * @return int Number of logical cache keys removed.
     */
    public function deleteUrl(CacheKey $key): int
    {
        try {
            $scope = $this->baseDirectory . '/' . $key->scopeRelativePath();
            if (! is_dir($scope) || ! $this->isWithinBase($scope)) {
                return 0;
            }

            $globalLock = $this->acquireLock($this->globalLockPath(), LOCK_SH, false);
            if ($globalLock === null) {
                return 0;
            }

            try {
                $prefixes = [];
                $scanned = 0;
                $truncated = false;
                $deadline = microtime(true) + (max(250, min(1000, $this->maintenanceBudgetMs * 4)) / 1000);
                $iterator = new FilesystemIterator($scope, FilesystemIterator::SKIP_DOTS);
                foreach ($iterator as $file) {
                    if ($scanned >= $this->maintenanceScanLimit || microtime(true) >= $deadline) {
                        $truncated = true;
                        break;
                    }
                    $scanned++;
                    if ($file->isLink() || ! $file->isFile()) {
                        continue;
                    }

                    $filename = $file->getFilename();
                    if (preg_match('/^([a-f0-9]{64})\.(?:identity|gzip|br)\.meta\.json$/D', $filename, $match) === 1) {
                        $prefixes[$scope . '/' . $match[1]] = true;
                    }
                }

                $deleted = 0;
                $deleteDeadline = microtime(true) + (max(250, min(1000, $this->maintenanceBudgetMs * 4)) / 1000);
                foreach (array_keys($prefixes) as $prefix) {
                    if (microtime(true) >= $deleteDeadline) {
                        $truncated = true;
                        break;
                    }

                    $entryLock = $this->acquireLock($prefix . '.lock', LOCK_EX, true);
                    if ($entryLock === null) {
                        continue;
                    }

                    try {
                        $metadata = $this->readAnyMetadata($prefix);
                        if (($metadata['canonical_url'] ?? null) !== $key->canonicalUrl()) {
                            continue;
                        }

                        if ($this->deletePrefix($prefix)) {
                            $deleted++;
                        }
                    } finally {
                        $this->releaseLock($entryLock);
                    }
                }

                if ($truncated) {
                    $this->log('warning', 'cache_url_scan_truncated', ['blog_id' => $key->blogId()]);
                }

                return $deleted;
            } finally {
                $this->releaseLock($globalLock);
            }
        } catch (Throwable $error) {
            $this->log('error', 'cache_url_purge_failed', [
                'key' => $key->hash(),
                'error' => $error::class,
            ]);

            return 0;
        }
    }

    /**
     * Purges entries carrying at least one requested dependency tag.
     *
     * @param list<string> $tags
     * @return int Number of logical cache keys removed.
     */
    public function purgeByTags(array $tags, ?int $blogId = null): int
    {
        $tags = array_values(array_unique(array_filter(
            array_map(static fn (mixed $tag): string => is_scalar($tag) ? trim((string) $tag) : '', $tags),
        )));
        if ($tags === [] || ! is_dir($this->baseDirectory)) {
            return 0;
        }

        try {
            $globalLock = $this->acquireLock($this->globalLockPath(), LOCK_SH, false);
            if ($globalLock === null) {
                return 0;
            }

            try {
                $deadline = microtime(true) + (max(250, min(1000, $this->maintenanceBudgetMs * 4)) / 1000);
                $actionDeadline = $deadline + (max(250, min(1000, $this->maintenanceBudgetMs * 4)) / 1000);
                $rootResult = $this->discoverPageRoots($blogId, $deadline, self::MAX_SITE_ROOTS);
                $remaining = max(0, self::STATS_SCAN_LIMIT - $rootResult['scanned']);
                $truncated = $rootResult['truncated'];
                $deleted = 0;
                foreach ($rootResult['roots'] as $root) {
                    if ($remaining < 1 || microtime(true) >= $deadline) {
                        $truncated = true;
                        break;
                    }

                    $result = $this->scanPageRoot($root, $remaining, $deadline, true);
                    $remaining = max(0, $remaining - $result['scanned']);
                    $truncated = $truncated || $result['truncated'];

                    foreach (array_keys($result['entries']) as $prefix) {
                        if (microtime(true) >= $actionDeadline) {
                            $truncated = true;
                            break 2;
                        }

                        $entryLock = $this->acquireLock($prefix . '.lock', LOCK_EX, true);
                        if ($entryLock === null) {
                            continue;
                        }

                        try {
                            $metadata = $this->readAnyMetadata($prefix);
                            $entryTags = is_array($metadata['tags'] ?? null) ? $metadata['tags'] : [];
                            if (array_intersect($tags, $entryTags) !== [] && $this->deletePrefix($prefix)) {
                                $deleted++;
                            }
                        } finally {
                            $this->releaseLock($entryLock);
                        }
                    }
                }

                if ($truncated) {
                    $this->log('warning', 'cache_tag_scan_truncated', ['blog_id' => $blogId]);
                }

                return $deleted;
            } finally {
                $this->releaseLock($globalLock);
            }
        } catch (Throwable $error) {
            $this->log('error', 'cache_tag_purge_failed', ['error' => $error::class]);

            return 0;
        }
    }

    /**
     * Purges page entries for one site when a blog id is supplied, or page
     * entries for every site when null. Asset caches, logs, the base directory
     * and the pages access-protection files are retained.
     *
     * @return int Number of logical cache keys removed.
     */
    public function purgeAll(?int $blogId = null): int
    {
        $this->lastPurgeSucceeded = true;

        try {
            if (! is_dir($this->baseDirectory)) {
                if (file_exists($this->baseDirectory) || is_link($this->baseDirectory)) {
                    $this->lastPurgeSucceeded = false;
                }

                return 0;
            }

            if (! $this->directoryChainIsSafe($this->baseDirectory)
                || $this->hasUnsafePageRoot($blogId)) {
                $this->lastPurgeSucceeded = false;
                $this->log('warning', 'cache_purge_path_unsafe', ['blog_id' => $blogId]);

                return 0;
            }

            $globalLock = $this->acquireLock($this->globalLockPath(), LOCK_EX, false);
            if ($globalLock === null) {
                $this->lastPurgeSucceeded = false;
                $this->log('warning', 'cache_purge_lock_unavailable', ['blog_id' => $blogId]);

                return 0;
            }

            try {
                $deleted = 0;
                foreach ($this->pageRootIterator($blogId) as $root) {
                    if (! is_dir($root) || is_link($root) || ! $this->isWithinBase($root)) {
                        $this->lastPurgeSucceeded = false;
                        continue;
                    }

                    // Keep the protected pages root while removing only its data.
                    $keys = [];
                    if (! $this->clearPath($root, $keys, false, false, true)) {
                        $this->lastPurgeSucceeded = false;
                    }
                    $deleted += count($keys);
                    $rootBlogId = $this->blogIdFromPagesDirectory($root);
                    if ($rootBlogId !== null && ! $this->ensurePageProtection($rootBlogId)) {
                        $this->lastPurgeSucceeded = false;
                    }
                }

                return $deleted;
            } finally {
                $this->releaseLock($globalLock);
            }
        } catch (Throwable $error) {
            $this->lastPurgeSucceeded = false;
            $this->log('error', 'cache_purge_failed', [
                'blog_id' => $blogId,
                'error' => $error::class,
            ]);

            return 0;
        }
    }

    public function purge(?int $blogId = null): int
    {
        return $this->purgeAll($blogId);
    }

    /**
     * Removes expired/corrupt entries without touching fresh cache data.
     */
    public function pruneExpired(?int $blogId = null, ?int $now = null): int
    {
        if (! is_dir($this->baseDirectory)) {
            return 0;
        }

        $now ??= time();

        try {
            $globalLock = $this->acquireLock($this->globalLockPath(), LOCK_SH, false);
            if ($globalLock === null) {
                return 0;
            }

            try {
                $deadline = microtime(true) + (max(250, min(1000, $this->maintenanceBudgetMs * 4)) / 1000);
                $actionDeadline = $deadline + (max(250, min(1000, $this->maintenanceBudgetMs * 4)) / 1000);
                $rootResult = $this->discoverPageRoots($blogId, $deadline, self::MAX_SITE_ROOTS);
                $remaining = max(0, self::STATS_SCAN_LIMIT - $rootResult['scanned']);
                $truncated = $rootResult['truncated'];
                $deleted = 0;
                foreach ($rootResult['roots'] as $root) {
                    if ($remaining < 1 || microtime(true) >= $deadline) {
                        $truncated = true;
                        break;
                    }

                    $result = $this->scanPageRoot($root, $remaining, $deadline, true);
                    $remaining = max(0, $remaining - $result['scanned']);
                    $truncated = $truncated || $result['truncated'];

                    foreach (array_keys($result['entries']) as $prefix) {
                        if (microtime(true) >= $actionDeadline) {
                            $truncated = true;
                            break 2;
                        }

                        $entryLock = $this->acquireLock($prefix . '.lock', LOCK_EX, true);
                        if ($entryLock === null) {
                            continue;
                        }

                        try {
                            $metadata = $this->readAnyMetadata($prefix);
                            $expiresAt = filter_var($metadata['expires_at'] ?? null, FILTER_VALIDATE_INT);
                            if (($metadata === [] || $expiresAt === false || $expiresAt <= $now)
                                && $this->deletePrefix($prefix)) {
                                $deleted++;
                            }
                        } finally {
                            $this->releaseLock($entryLock);
                        }
                    }
                }

                if ($truncated) {
                    $this->log('warning', 'cache_prune_scan_truncated', ['blog_id' => $blogId]);
                }

                return $deleted;
            } finally {
                $this->releaseLock($globalLock);
            }
        } catch (Throwable $error) {
            $this->log('error', 'cache_prune_failed', ['error' => $error::class]);

            return 0;
        }
    }

    private function writeEntryVariants(string $prefix, CacheKey $key, CacheEntry $entry): bool
    {
        $encoding = $entry->encoding();
        if ($encoding !== 'identity') {
            return $this->writeVariant($prefix, $key, $entry);
        }

        // Brotli is accepted as an explicit representation, but is not yet
        // generated from identity. Remove it before refreshing identity so an
        // older .br body can never outlive the logical response it represents.
        // Deleting first also leaves the previous generation coherent if the
        // filesystem refuses the operation.
        if (! $this->deleteVariant($prefix, 'br')) {
            $this->log('warning', 'cache_brotli_cleanup_failed', ['key' => $key->hash()]);

            return false;
        }

        $identity = $entry;
        $gzip = null;
        if ($this->writeGzip && function_exists('gzencode')) {
            $compressed = gzencode($entry->body(), $this->gzipLevel, ZLIB_ENCODING_GZIP);
            if (is_string($compressed) && strlen($compressed) <= $this->maxEntryBytes) {
                // Negotiated identity responses also need Vary: Accept-Encoding.
                $identity = new CacheEntry(
                    $entry->body(),
                    $entry->ttl(),
                    $entry->headers(),
                    $entry->status(),
                    $entry->createdAt(),
                    array_merge($entry->vary(), ['Accept-Encoding']),
                    'identity',
                    $entry->tags(),
                    $entry->metadata(),
                );
                $gzip = $identity->withBodyAndEncoding($compressed, 'gzip');
            }
        }

        $identityWritten = $this->writeVariant($prefix, $key, $identity);
        if (! $identityWritten) {
            return false;
        }

        if ($gzip !== null) {
            if (! $this->writeVariant($prefix, $key, $gzip)) {
                $this->deleteVariant($prefix, 'gzip');
                $this->log('warning', 'cache_gzip_write_failed', ['key' => $key->hash()]);
            }
        } else {
            // Never retain an old encoded representation after identity refresh.
            $this->deleteVariant($prefix, 'gzip');
        }

        return true;
    }

    private function writeVariant(string $prefix, CacheKey $key, CacheEntry $entry): bool
    {
        if (strlen($entry->body()) > $this->maxEntryBytes) {
            return false;
        }

        $paths = $this->variantPaths($prefix, $entry->encoding());
        $metadata = $entry->toMetadata([
            'key_hash' => $key->hash(),
            'blog_id' => $key->blogId(),
            'canonical_url' => $key->canonicalUrl(),
            'key' => $key->jsonSerialize(),
            'stored_at' => time(),
        ]);

        try {
            $json = json_encode(
                $metadata,
                JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
            );
        } catch (JsonException) {
            return false;
        }

        if (strlen($json) > self::MAX_METADATA_BYTES) {
            return false;
        }

        if (! $this->atomicWrite($paths['body'], $entry->body())) {
            return false;
        }

        if (! $this->atomicWrite($paths['metadata'], $json)) {
            return false;
        }

        return true;
    }

    private function readVariant(string $prefix, string $encoding, CacheKey $key): ?CacheEntry
    {
        $paths = $this->variantPaths($prefix, $encoding);
        if (! is_file($paths['metadata']) || ! is_file($paths['body'])
            || is_link($paths['metadata']) || is_link($paths['body'])) {
            return null;
        }

        $metadataSize = @filesize($paths['metadata']);
        $bodySize = @filesize($paths['body']);
        if (! is_int($metadataSize) || $metadataSize < 2 || $metadataSize > self::MAX_METADATA_BYTES
            || ! is_int($bodySize) || $bodySize < 0 || $bodySize > $this->maxEntryBytes) {
            return null;
        }

        $rawMetadata = @file_get_contents($paths['metadata']);
        if (! is_string($rawMetadata)) {
            return null;
        }

        try {
            $metadata = json_decode($rawMetadata, true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return null;
        }
        if (! is_array($metadata)
            || ($metadata['key_hash'] ?? null) !== $key->hash()
            || ($metadata['encoding'] ?? null) !== $encoding
            || ($metadata['canonical_url'] ?? null) !== $key->canonicalUrl()) {
            return null;
        }

        $body = @file_get_contents($paths['body']);
        if (! is_string($body)) {
            return null;
        }
        if ($encoding === 'gzip' && ! str_starts_with($body, "\x1f\x8b")) {
            return null;
        }

        return CacheEntry::fromMetadata($metadata, $body);
    }

    /** @return array<string, mixed> */
    private function readAnyMetadata(string $prefix): array
    {
        foreach (self::ENCODINGS as $encoding) {
            $path = $this->variantPaths($prefix, $encoding)['metadata'];
            if (! is_file($path) || is_link($path)) {
                continue;
            }

            $size = @filesize($path);
            if (! is_int($size) || $size < 2 || $size > self::MAX_METADATA_BYTES) {
                continue;
            }

            $raw = @file_get_contents($path);
            if (! is_string($raw)) {
                continue;
            }

            try {
                $metadata = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                continue;
            }

            if (is_array($metadata)) {
                return $metadata;
            }
        }

        return [];
    }

    /**
     * @return array{
     *   entries:array<string,array{bytes:int,expires_at:int,stored_at:int}>,
     *   variants:int,bytes:int,scanned:int,truncated:bool
     * }
     */
    private function scanPageRoot(string $root, int $limit, float $deadline, bool $readMetadata): array
    {
        $result = [
            'entries' => [],
            'variants' => 0,
            'bytes' => 0,
            'scanned' => 0,
            'truncated' => false,
        ];
        if ($limit < 1 || ! is_dir($root) || is_link($root) || ! $this->isWithinBase($root)) {
            return $result;
        }

        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::SELF_FIRST,
        );

        foreach ($iterator as $file) {
            if ($result['scanned'] >= $limit || microtime(true) >= $deadline) {
                $result['truncated'] = true;
                break;
            }

            if ($file->isLink() || ! $file->isFile()) {
                $result['scanned']++;
                continue;
            }

            // Entry lock files are intentionally persistent so two processes
            // can never lock different inodes for the same key. They are not
            // cache data and must not exhaust metadata scan quotas.
            if (str_ends_with($file->getFilename(), '.lock')) {
                continue;
            }
            $result['scanned']++;

            $path = str_replace('\\', '/', $file->getPathname());
            if (! $this->isWithinBase($path)
                || preg_match('/^(.*\/([a-f0-9]{64}))(\.html(?:\.(?:gz|br))?|\.(identity|gzip|br)\.meta\.json)$/D', $path, $match) !== 1) {
                continue;
            }

            $prefix = $match[1];
            $size = max(0, (int) $file->getSize());
            if (! isset($result['entries'][$prefix])) {
                $modified = $file->getMTime();
                $result['entries'][$prefix] = [
                    'bytes' => 0,
                    'expires_at' => 0,
                    'stored_at' => is_int($modified) ? $modified : 0,
                ];
            }

            $result['entries'][$prefix]['bytes'] += $size;
            $result['bytes'] += $size;

            if (($match[4] ?? '') === '') {
                continue;
            }

            $result['variants']++;
            if (! $readMetadata) {
                continue;
            }

            $metadata = $this->readMetadataFile($path);
            if ($metadata === []) {
                continue;
            }

            $expiresAt = filter_var($metadata['expires_at'] ?? null, FILTER_VALIDATE_INT);
            $storedAt = filter_var($metadata['stored_at'] ?? $metadata['created_at'] ?? null, FILTER_VALIDATE_INT);
            if ($expiresAt !== false) {
                $result['entries'][$prefix]['expires_at'] = max(
                    $result['entries'][$prefix]['expires_at'],
                    $expiresAt,
                );
            }
            if ($storedAt !== false) {
                $result['entries'][$prefix]['stored_at'] = max(
                    $result['entries'][$prefix]['stored_at'],
                    $storedAt,
                );
            }
        }

        return $result;
    }

    /** @return array<string, mixed> */
    private function readMetadataFile(string $path): array
    {
        if (! is_file($path) || is_link($path)) {
            return [];
        }

        $size = @filesize($path);
        if (! is_int($size) || $size < 2 || $size > self::MAX_METADATA_BYTES) {
            return [];
        }

        $raw = @file_get_contents($path);
        if (! is_string($raw)) {
            return [];
        }

        try {
            $metadata = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return [];
        }

        return is_array($metadata) ? $metadata : [];
    }

    /**
     * @return array{roots:list<string>,scanned:int,truncated:bool}
     */
    private function discoverPageRoots(?int $blogId, float $deadline, int $limit): array
    {
        if ($blogId !== null) {
            $root = $this->siteDirectory($blogId);

            return [
                'roots' => is_dir($root) && ! is_link($root) ? [$root] : [],
                'scanned' => 1,
                'truncated' => false,
            ];
        }

        $result = ['roots' => [], 'scanned' => 0, 'truncated' => false];
        if (! is_dir($this->baseDirectory)) {
            return $result;
        }

        $iterator = new FilesystemIterator($this->baseDirectory, FilesystemIterator::SKIP_DOTS);
        foreach ($iterator as $item) {
            if ($result['scanned'] >= $limit || microtime(true) >= $deadline) {
                $result['truncated'] = true;
                break;
            }
            $result['scanned']++;

            if ($item->isLink() || ! $item->isDir() || preg_match('/^[1-9][0-9]*$/D', $item->getFilename()) !== 1) {
                continue;
            }

            $root = str_replace('\\', '/', $item->getPathname()) . '/pages';
            if (is_dir($root) && ! is_link($root) && $this->isWithinBase($root)) {
                $result['roots'][] = $root;
            }
        }

        return $result;
    }

    /** @return iterable<string> */
    private function pageRootIterator(?int $blogId): iterable
    {
        if ($blogId !== null) {
            $root = $this->siteDirectory($blogId);
            if (is_dir($root) && ! is_link($root)) {
                yield $root;
            }

            return;
        }

        if (! is_dir($this->baseDirectory)) {
            return;
        }

        $iterator = new FilesystemIterator($this->baseDirectory, FilesystemIterator::SKIP_DOTS);
        foreach ($iterator as $item) {
            if ($item->isLink() || ! $item->isDir() || preg_match('/^[1-9][0-9]*$/D', $item->getFilename()) !== 1) {
                continue;
            }

            $root = str_replace('\\', '/', $item->getPathname()) . '/pages';
            if (is_dir($root) && ! is_link($root) && $this->isWithinBase($root)) {
                yield $root;
            }
        }
    }

    /**
     * Detects a path that looks like one of our site/page roots but cannot be
     * traversed safely. Silently skipping it would make purgeAll() report an
     * empty-cache success while stale data may still exist behind a symlink or
     * non-directory filesystem node.
     */
    private function hasUnsafePageRoot(?int $blogId): bool
    {
        if ($blogId !== null) {
            $root = $this->siteDirectory($blogId);
            $siteRoot = dirname($root);

            return is_link($siteRoot)
                || (file_exists($siteRoot) && ! is_dir($siteRoot))
                || (is_dir($siteRoot) && ! $this->directoryChainIsSafe($siteRoot))
                || is_link($root)
                || (file_exists($root) && ! is_dir($root))
                || (is_dir($root) && ! $this->directoryChainIsSafe($root));
        }

        if (! is_dir($this->baseDirectory) || is_link($this->baseDirectory)) {
            return true;
        }

        $iterator = new FilesystemIterator($this->baseDirectory, FilesystemIterator::SKIP_DOTS);
        foreach ($iterator as $item) {
            if (preg_match('/^[1-9][0-9]*$/D', $item->getFilename()) !== 1) {
                continue;
            }
            if ($item->isLink() || ! $item->isDir()) {
                return true;
            }

            $root = str_replace('\\', '/', $item->getPathname()) . '/pages';
            if (is_link($root)
                || (file_exists($root) && ! is_dir($root))
                || (is_dir($root) && ! $this->directoryChainIsSafe($root))) {
                return true;
            }
        }

        return false;
    }

    private function maintainSiteQuota(
        int $blogId,
        string $protectedPrefix,
        int $incomingBytes,
        bool $incomingIsNew,
    ): bool {
        $root = $this->siteDirectory($blogId);
        if (! is_dir($root)) {
            return true;
        }

        $deadline = microtime(true) + ($this->maintenanceBudgetMs / 1000);
        $result = $this->scanPageRoot($root, $this->maintenanceScanLimit, $deadline, true);
        $entries = $result['entries'];
        $projectedEntries = count($entries) + ($incomingIsNew ? 1 : 0);
        $projectedBytes = max(0, $result['bytes'] + $incomingBytes);
        $now = time();

        uasort($entries, static function (array $left, array $right) use ($now): int {
            $leftExpired = $left['expires_at'] < 1 || $left['expires_at'] <= $now;
            $rightExpired = $right['expires_at'] < 1 || $right['expires_at'] <= $now;
            if ($leftExpired !== $rightExpired) {
                return $leftExpired ? -1 : 1;
            }

            return $left['stored_at'] <=> $right['stored_at'];
        });

        $evicted = 0;
        $evictionDeadline = microtime(true) + ($this->maintenanceBudgetMs / 1000);
        foreach ($entries as $prefix => $details) {
            if ($evicted >= $this->maxEvictionsPerWrite || microtime(true) >= $evictionDeadline) {
                break;
            }

            $expired = $details['expires_at'] < 1 || $details['expires_at'] <= $now;
            $overQuota = $projectedEntries > $this->maxSiteEntries || $projectedBytes > $this->maxSiteBytes;
            if (! $expired && ! $overQuota && ! $result['truncated']) {
                break;
            }
            if ($prefix === $protectedPrefix) {
                continue;
            }

            $entryLock = $this->acquireLock($prefix . '.lock', LOCK_EX, true);
            if ($entryLock === null) {
                continue;
            }

            try {
                $currentMetadata = $this->readAnyMetadata($prefix);
                $currentStoredAt = (int) ($currentMetadata['stored_at'] ?? $currentMetadata['created_at'] ?? 0);
                if ($currentStoredAt > $details['stored_at']) {
                    continue;
                }

                $currentBytes = $this->prefixBytes($prefix);
                $hadData = $this->prefixHasData($prefix);
                if ($hadData && $this->deletePrefix($prefix)) {
                    $projectedEntries = max(0, $projectedEntries - 1);
                    $projectedBytes = max(0, $projectedBytes - $currentBytes);
                    $evicted++;
                }
            } finally {
                $this->releaseLock($entryLock);
            }
        }

        if ($result['truncated']) {
            $this->log('warning', 'cache_quota_scan_truncated', ['blog_id' => $blogId]);
            if ($incomingIsNew || $incomingBytes > 0) {
                return false;
            }
        }

        return $projectedEntries <= $this->maxSiteEntries && $projectedBytes <= $this->maxSiteBytes;
    }

    private function estimateEntryBytes(CacheEntry $entry): int
    {
        $representations = $entry->encoding() === 'identity' && $this->writeGzip ? 2 : 1;
        $bodyBytes = strlen($entry->body()) * $representations;

        return $bodyBytes + ($representations * 8192);
    }

    private function prefixBytes(string $prefix): int
    {
        $bytes = 0;
        foreach (self::ENCODINGS as $encoding) {
            foreach ($this->variantPaths($prefix, $encoding) as $path) {
                if (is_file($path) && ! is_link($path)) {
                    $size = @filesize($path);
                    if (is_int($size) && $size > 0) {
                        $bytes += $size;
                    }
                }
            }
        }

        return $bytes;
    }

    private function prefixHasData(string $prefix): bool
    {
        foreach (self::ENCODINGS as $encoding) {
            foreach ($this->variantPaths($prefix, $encoding) as $path) {
                if (is_file($path) && ! is_link($path)) {
                    return true;
                }
            }
        }

        return false;
    }

    private function deletePrefix(string $prefix): bool
    {
        if (! $this->isWithinBase($prefix)) {
            return false;
        }

        $success = true;
        foreach (self::ENCODINGS as $encoding) {
            $success = $this->deleteVariant($prefix, $encoding) && $success;
        }

        return $success;
    }

    private function deleteVariant(string $prefix, string $encoding): bool
    {
        $success = true;
        foreach ($this->variantPaths($prefix, $encoding) as $path) {
            if ((file_exists($path) || is_link($path)) && ! @unlink($path)) {
                $success = false;
            }
        }

        return $success;
    }

    /**
     * @param array<string, true> $keys
     */
    private function clearPath(
        string $path,
        array &$keys,
        bool $removeRoot,
        bool $preserveGlobalLock = false,
        bool $preservePageProtection = false,
    ): bool
    {
        if (! $this->isWithinBase($path, true)) {
            throw new RuntimeException('Unsafe cache purge path.');
        }

        if (is_link($path) || ! is_dir($path)) {
            if ($removeRoot && (file_exists($path) || is_link($path))) {
                return @unlink($path);
            }

            return ! file_exists($path) && ! is_link($path);
        }

        $success = true;
        $iterator = new FilesystemIterator($path, FilesystemIterator::SKIP_DOTS);
        foreach ($iterator as $item) {
            $name = $item->getFilename();
            if ($preserveGlobalLock && $path === $this->baseDirectory && $name === '.purge.lock') {
                continue;
            }
            if ($preservePageProtection && in_array($name, ['.htaccess', 'web.config', 'index.php'], true)) {
                continue;
            }

            $child = $path . '/' . $name;
            if (is_link($child)) {
                if (! @unlink($child)) {
                    $success = false;
                }
                continue;
            }
            if (is_dir($child)) {
                if (! $this->clearPath($child, $keys, true, false, false)) {
                    $success = false;
                }
                continue;
            }

            $matchesEntry = preg_match('/^([a-f0-9]{64})\.(?:html(?:\.(?:gz|br))?|(?:identity|gzip|br)\.meta\.json)$/D', $name, $match) === 1;
            if (@unlink($child)) {
                if ($matchesEntry) {
                    $keys[dirname($child) . '/' . $match[1]] = true;
                }
            } else {
                $success = false;
            }
        }
        unset($iterator);

        if ($removeRoot && ! @rmdir($path)) {
            $success = false;
        }

        return $success;
    }

    private function atomicWrite(string $target, string $contents): bool
    {
        $directory = dirname($target);
        if (! $this->ensureDirectory($directory)
            || ! $this->isWithinBase($target)
            || ! $this->directoryChainIsSafe($directory)) {
            return false;
        }

        $temporary = @tempnam($directory, '.kodety-rocket-');
        if (! is_string($temporary)
            || is_link($temporary)
            || ! $this->resolvedPathIsWithinBase($temporary)) {
            if (is_string($temporary) && (is_file($temporary) || is_link($temporary))) {
                @unlink($temporary);
            }

            return false;
        }

        // tempnam created the file. Open without truncation, verify the opened
        // inode still matches the path, and only then truncate/write it.
        $handle = @fopen($temporary, 'c+b');
        if ($handle === false) {
            @unlink($temporary);

            return false;
        }

        if (! $this->openedFileMatchesPath($handle, $temporary)
            || ! $this->directoryChainIsSafe($directory)
            || ! @ftruncate($handle, 0)) {
            @fclose($handle);
            if (is_file($temporary) && ! is_link($temporary)) {
                @unlink($temporary);
            }

            return false;
        }

        $success = true;
        $length = strlen($contents);
        $written = 0;

        try {
            while ($written < $length) {
                $bytes = @fwrite($handle, substr($contents, $written));
                if (! is_int($bytes) || $bytes < 1) {
                    $success = false;
                    break;
                }
                $written += $bytes;
            }

            if ($success && ! @fflush($handle)) {
                $success = false;
            }
            if ($success && function_exists('fsync') && ! @fsync($handle)) {
                $success = false;
            }
        } finally {
            @fclose($handle);
        }

        if ($success && $this->directoryChainIsSafe($directory)) {
            $mode = defined('FS_CHMOD_FILE') ? (int) constant('FS_CHMOD_FILE') : 0644;
            @chmod($temporary, $mode);
            $success = @rename($temporary, $target);
        } elseif ($success) {
            $success = false;
        }

        if (! $success && (file_exists($temporary) || is_link($temporary))) {
            @unlink($temporary);
        }

        return $success;
    }

    /** @return resource|null */
    private function acquireLock(string $path, int $operation, bool $createDirectory)
    {
        if ($createDirectory && ! $this->ensureDirectory(dirname($path))) {
            return null;
        }
        if (! is_dir(dirname($path))
            || ! $this->isWithinBase($path, true)
            || ! $this->directoryChainIsSafe(dirname($path))
            || is_link($path)) {
            return null;
        }

        $handle = @fopen($path, 'x+b');
        if ($handle === false) {
            if (! is_file($path) || is_link($path)) {
                return null;
            }
            $handle = @fopen($path, 'c+b');
        }
        if ($handle === false) {
            return null;
        }
        if (! $this->openedFileMatchesPath($handle, $path)
            || ! $this->directoryChainIsSafe(dirname($path))) {
            @fclose($handle);

            return null;
        }

        $deadline = microtime(true) + ($this->lockTimeoutMs / 1000);
        do {
            if (@flock($handle, $operation | LOCK_NB)) {
                return $handle;
            }
            if ($this->lockTimeoutMs === 0) {
                break;
            }
            usleep(10000);
        } while (microtime(true) < $deadline);

        @fclose($handle);

        return null;
    }

    /** @param resource $handle */
    private function releaseLock($handle): void
    {
        @flock($handle, LOCK_UN);
        @fclose($handle);
    }

    private function entryPrefix(CacheKey $key): string
    {
        $relative = $key->relativePath();
        if (preg_match('#^[1-9][0-9]*/pages/[a-f0-9]{64}/[a-f0-9]{64}/[a-f0-9]{64}$#D', $relative) !== 1) {
            throw new RuntimeException('Unsafe cache-key path.');
        }

        $path = $this->baseDirectory . '/' . $relative;
        if (! $this->isWithinBase($path)) {
            throw new RuntimeException('Cache-key escaped the cache directory.');
        }

        return $path;
    }

    /** @param list<string> $encodings */
    private function hasAnyVariantFile(string $prefix, array $encodings): bool
    {
        foreach ($encodings as $encoding) {
            $paths = $this->variantPaths($prefix, $encoding);
            if ((is_file($paths['metadata']) && ! is_link($paths['metadata']))
                || (is_file($paths['body']) && ! is_link($paths['body']))) {
                return true;
            }
        }

        return false;
    }

    /** @return array{body: string, metadata: string} */
    private function variantPaths(string $prefix, string $encoding): array
    {
        if (! in_array($encoding, self::ENCODINGS, true)) {
            throw new RuntimeException('Unsupported cache encoding.');
        }

        $bodySuffix = match ($encoding) {
            'identity' => '.html',
            'gzip' => '.html.gz',
            'br' => '.html.br',
        };

        return [
            'body' => $prefix . $bodySuffix,
            'metadata' => $prefix . '.' . $encoding . '.meta.json',
        ];
    }

    /** @return list<string> */
    private function encodingPreferences(string $encoding): array
    {
        $encoding = strtolower(trim($encoding));
        if (in_array($encoding, self::ENCODINGS, true)) {
            return $encoding === 'identity' ? ['identity'] : [$encoding, 'identity'];
        }

        $weighted = [];
        foreach (explode(',', $encoding) as $position => $part) {
            $segments = array_map('trim', explode(';', $part));
            $name = strtolower((string) array_shift($segments));
            if (! in_array($name, ['gzip', 'br', 'identity', '*'], true)) {
                continue;
            }

            $quality = 1.0;
            foreach ($segments as $segment) {
                if (preg_match('/^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/iD', $segment, $match) === 1) {
                    $quality = (float) $match[1];
                }
            }
            if ($quality > 0) {
                $weighted[] = ['name' => $name, 'quality' => $quality, 'position' => $position];
            }
        }

        usort($weighted, static function (array $left, array $right): int {
            return ($right['quality'] <=> $left['quality']) ?: ($left['position'] <=> $right['position']);
        });

        $preferences = [];
        foreach ($weighted as $item) {
            $name = $item['name'];
            if ($name === '*') {
                foreach (['br', 'gzip'] as $candidate) {
                    if (! in_array($candidate, $preferences, true)) {
                        $preferences[] = $candidate;
                    }
                }
                continue;
            }
            if (! in_array($name, $preferences, true)) {
                $preferences[] = $name;
            }
        }

        if (! in_array('identity', $preferences, true)) {
            $preferences[] = 'identity';
        }

        return $preferences;
    }

    private function globalLockPath(): string
    {
        return $this->baseDirectory . '/.purge.lock';
    }

    private function siteDirectory(int $blogId): string
    {
        if ($blogId < 1) {
            throw new RuntimeException('Invalid cache blog id.');
        }

        return $this->baseDirectory . '/' . $blogId . '/pages';
    }

    private function blogIdFromPagesDirectory(string $directory): ?int
    {
        $directory = rtrim(str_replace('\\', '/', $directory), '/');
        $prefix = $this->baseDirectory . '/';
        if (! str_starts_with($directory, $prefix)) {
            return null;
        }

        $relative = substr($directory, strlen($prefix));
        if (preg_match('#^([1-9][0-9]*)/pages$#D', $relative, $match) !== 1) {
            return null;
        }

        $blogId = filter_var($match[1], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $blogId === false ? null : $blogId;
    }

    private function ensurePageProtection(int $blogId): bool
    {
        $directory = $this->siteDirectory($blogId);
        if (! $this->ensureDirectory($directory)) {
            return false;
        }

        $files = [
            '.htaccess' => "# Generated by Kodety Rocket.\n<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n    Order deny,allow\n    Deny from all\n</IfModule>\n",
            'web.config' => "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<configuration>\n  <system.webServer>\n    <security>\n      <authorization>\n        <remove users=\"*\" roles=\"\" verbs=\"\" />\n        <add accessType=\"Deny\" users=\"*\" />\n      </authorization>\n    </security>\n  </system.webServer>\n</configuration>\n",
            'index.php' => "<?php\nhttp_response_code(404);\nexit;\n",
        ];

        if (isset($this->protectedSites[$blogId])) {
            $intact = true;
            foreach ($files as $name => $contents) {
                $path = $directory . '/' . $name;
                if (! is_file($path) || is_link($path) || @file_get_contents($path) !== $contents) {
                    $intact = false;
                    break;
                }
            }
            if ($intact) {
                return true;
            }
        }

        foreach ($files as $name => $contents) {
            $path = $directory . '/' . $name;
            if (is_link($path) && ! @unlink($path)) {
                return false;
            }

            $existing = is_file($path) ? @file_get_contents($path) : false;
            if ($existing !== $contents && ! $this->atomicWrite($path, $contents)) {
                return false;
            }
        }

        $this->protectedSites[$blogId] = true;

        return true;
    }

    private function ensureDirectory(string $directory): bool
    {
        if (is_dir($directory)) {
            return ! is_link($directory) && $this->directoryChainIsSafe($directory);
        }
        if (file_exists($directory) || is_link($directory)) {
            return false;
        }

        if (! $this->isWithinBase($directory, true)) {
            return false;
        }

        if ($directory !== $this->baseDirectory) {
            $parent = dirname($directory);
            if (! $this->ensureDirectory($parent) || ! @mkdir($directory, 0755)) {
                return is_dir($directory) && ! is_link($directory) && $this->directoryChainIsSafe($directory);
            }

            return ! is_link($directory) && $this->directoryChainIsSafe($directory);
        }

        if (function_exists('wp_mkdir_p')) {
            $created = (bool) wp_mkdir_p($directory);
        } else {
            $created = @mkdir($directory, 0755, true) || is_dir($directory);
        }

        return $created && is_dir($directory) && ! is_link($directory) && $this->directoryChainIsSafe($directory);
    }

    private function directoryChainIsSafe(string $directory): bool
    {
        $directory = rtrim(str_replace('\\', '/', $directory), '/');
        if (! $this->isWithinBase($directory, true)
            || ! is_dir($this->baseDirectory)
            || is_link($this->baseDirectory)) {
            return false;
        }

        $current = $this->baseDirectory;
        if ($directory !== $this->baseDirectory) {
            $relative = substr($directory, strlen($this->baseDirectory) + 1);
            foreach (explode('/', $relative) as $segment) {
                if ($segment === '' || $segment === '.' || $segment === '..') {
                    return false;
                }
                $current .= '/' . $segment;
                if (is_link($current) || (file_exists($current) && ! is_dir($current))) {
                    return false;
                }
            }
        }

        $baseReal = realpath($this->baseDirectory);
        $directoryReal = realpath($directory);
        if ($baseReal === false || $directoryReal === false) {
            return false;
        }
        $baseReal = rtrim(str_replace('\\', '/', $baseReal), '/');
        $directoryReal = rtrim(str_replace('\\', '/', $directoryReal), '/');

        return $directoryReal === $baseReal || str_starts_with($directoryReal . '/', $baseReal . '/');
    }

    private function resolvedPathIsWithinBase(string $path): bool
    {
        if (is_link($path)) {
            return false;
        }
        $baseReal = realpath($this->baseDirectory);
        $pathReal = realpath($path);
        if ($baseReal === false || $pathReal === false) {
            return false;
        }
        $baseReal = rtrim(str_replace('\\', '/', $baseReal), '/');
        $pathReal = rtrim(str_replace('\\', '/', $pathReal), '/');

        return str_starts_with($pathReal . '/', $baseReal . '/');
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

    private function directoryIsWritable(string $directory): bool
    {
        $candidate = $directory;
        while (! file_exists($candidate) && dirname($candidate) !== $candidate) {
            $candidate = dirname($candidate);
        }

        return is_dir($candidate) && is_writable($candidate);
    }

    private function defaultBaseDirectory(): string
    {
        if (defined('WP_CONTENT_DIR')) {
            return rtrim((string) constant('WP_CONTENT_DIR'), '/\\') . '/cache/kodety-rocket';
        }
        if (defined('ABSPATH')) {
            return rtrim((string) constant('ABSPATH'), '/\\') . '/wp-content/cache/kodety-rocket';
        }

        return rtrim(sys_get_temp_dir(), '/\\') . '/wp-content/cache/kodety-rocket';
    }

    private function normalizeBaseDirectory(string $directory): string
    {
        if ($directory === '' || str_contains($directory, "\0")) {
            throw new RuntimeException('Invalid cache base directory.');
        }

        $directory = str_replace('\\', '/', trim($directory));
        if (! str_starts_with($directory, '/') && preg_match('/^[A-Za-z]:\//', $directory) !== 1) {
            $root = defined('ABSPATH') ? (string) constant('ABSPATH') : getcwd();
            if (! is_string($root) || $root === '') {
                throw new RuntimeException('Cannot resolve relative cache directory.');
            }
            $directory = rtrim(str_replace('\\', '/', $root), '/') . '/' . $directory;
        }

        $prefix = str_starts_with($directory, '/') ? '/' : '';
        $segments = [];
        foreach (explode('/', $directory) as $segment) {
            if ($segment === '' || $segment === '.') {
                continue;
            }
            if ($segment === '..') {
                if ($segments === []) {
                    throw new RuntimeException('Invalid cache base traversal.');
                }
                array_pop($segments);
                continue;
            }
            $segments[] = $segment;
        }

        $normalized = $prefix . implode('/', $segments);
        if ($normalized === '' || $normalized === '/') {
            throw new RuntimeException('Cache base directory is too broad.');
        }

        return rtrim($normalized, '/');
    }

    private function isWithinBase(string $path, bool $allowBase = false): bool
    {
        $path = rtrim(str_replace('\\', '/', $path), '/');
        if ($allowBase && $path === $this->baseDirectory) {
            return true;
        }

        return str_starts_with($path . '/', $this->baseDirectory . '/');
    }

    /** @param array<string, mixed> $context */
    private function log(string $level, string $message, array $context = []): void
    {
        try {
            if (is_callable($this->logger)) {
                ($this->logger)($level, $message, $context);

                return;
            }

            if (is_object($this->logger) && method_exists($this->logger, $level)) {
                $this->logger->{$level}($message, $context);

                return;
            }

            if (is_object($this->logger) && method_exists($this->logger, 'log')) {
                $this->logger->log($level, $message, $context);
            }
        } catch (Throwable) {
            // Diagnostics must never make a cache failure fatal.
        }
    }
}
