<?php

declare(strict_types=1);

namespace KodetyRocket\Optimization;

/** Bounded housekeeping for immutable CSS/JS copies owned by Kodety Rocket. */
final class AssetCacheMaintenance
{
    private const MAX_FILES = 2000;
    private const MAX_BYTES = 268435456;
    private const MAX_SCAN = 5000;
    private const MAX_REMOVALS = 64;
    // SettingsRepository caps page-cache entries at seven days. Assets are
    // touched whenever their URL is emitted, so this longer retention window
    // guarantees that a live page-cache entry cannot outlast its dependency.
    private const MAX_AGE = 2592000;
    private const TIME_BUDGET_SECONDS = 0.075;

    /**
     * @return array{files:int,bytes:int,removed:int,truncated:bool}
     */
    public static function prune(?int $blogId = null): array
    {
        $result = ['files' => 0, 'bytes' => 0, 'removed' => 0, 'truncated' => false];
        $root = self::directory($blogId);
        if ($root === null || !is_dir($root)) {
            return $result;
        }
        if (!self::directoryIsSafe($root)) {
            $result['truncated'] = true;

            return $result;
        }

        $deadline = microtime(true) + self::TIME_BUDGET_SECONDS;
        $cutoff = time() - self::MAX_AGE;
        $entries = [];
        $scanned = 0;

        foreach (['css', 'js'] as $type) {
            $directory = $root . '/' . $type;
            if (!is_dir($directory)) {
                continue;
            }
            if (!self::directoryIsSafe($directory)) {
                $result['truncated'] = true;
                continue;
            }

            try {
                $iterator = new \DirectoryIterator($directory);
            } catch (\Throwable $exception) {
                continue;
            }

            foreach ($iterator as $item) {
                if ($item->isDot() || $item->isLink() || !$item->isFile()) {
                    continue;
                }
                if (++$scanned > self::MAX_SCAN || microtime(true) >= $deadline) {
                    $result['truncated'] = true;
                    break 2;
                }

                $name = $item->getFilename();
                $path = $item->getPathname();
                if (preg_match('/^[a-f0-9]{64}\.min\.' . $type . '$/', $name) !== 1) {
                    // Per-asset locks are deliberately persistent. Removing a
                    // lock pathname can let two workers flock different inodes.
                    // Temporary files are owned and removed by their builder;
                    // maintenance cannot prove that an observed one is idle.
                    continue;
                }

                $size = max(0, (int) $item->getSize());
                $modified = (int) $item->getMTime();
                if ($modified < $cutoff
                    && $result['removed'] < self::MAX_REMOVALS
                    && self::removeAsset($path, $type, $cutoff)) {
                    $result['removed']++;
                    continue;
                }

                clearstatcache(true, $path);
                if (!is_file($path) || is_link($path)) {
                    continue;
                }
                $currentSize = @filesize($path);
                $currentModified = @filemtime($path);
                if (!is_int($currentSize) || !is_int($currentModified)) {
                    $result['truncated'] = true;
                    continue;
                }

                $size = max(0, $currentSize);
                $modified = $currentModified;
                $entries[] = ['path' => $path, 'type' => $type, 'size' => $size, 'modified' => $modified];
                $result['files']++;
                $result['bytes'] += $size;
            }
        }

        usort($entries, static fn (array $left, array $right): int => $left['modified'] <=> $right['modified']);
        foreach ($entries as $entry) {
            $overQuota = $result['files'] > self::MAX_FILES || $result['bytes'] > self::MAX_BYTES;
            // When the scan was truncated, remove a bounded number of the
            // oldest observed entries so repeated runs still converge.
            if (!$overQuota && !$result['truncated']) {
                break;
            }
            if ($result['removed'] >= self::MAX_REMOVALS || microtime(true) >= $deadline) {
                $result['truncated'] = true;
                break;
            }

            // Quotas are intentionally soft. A recently used immutable asset
            // may still be present in page-cache HTML, so pressure or a
            // truncated scan must never override the retention invariant.
            if ($entry['modified'] >= $cutoff) {
                continue;
            }
            if (self::removeAsset($entry['path'], $entry['type'], $cutoff)) {
                $result['files']--;
                $result['bytes'] -= $entry['size'];
                $result['removed']++;
            }
        }

        return $result;
    }

    public static function purge(?int $blogId = null): bool
    {
        $root = self::directory($blogId);
        if ($root === null || !is_dir($root)) {
            return true;
        }
        if (!self::directoryIsSafe($root)) {
            return false;
        }

        $success = true;
        foreach (['css', 'js'] as $type) {
            $directory = $root . '/' . $type;
            if (!is_dir($directory)) {
                continue;
            }
            if (!self::directoryIsSafe($directory)) {
                $success = false;
                continue;
            }
            try {
                $iterator = new \DirectoryIterator($directory);
                foreach ($iterator as $item) {
                    if ($item->isDot() || $item->isLink() || !$item->isFile()) {
                        continue;
                    }
                    $name = $item->getFilename();
                    if (preg_match('/^[a-f0-9]{64}\.min\.' . $type . '$/', $name) === 1) {
                        if (!self::removeAsset($item->getPathname(), $type, null)) {
                            $success = false;
                        }
                        continue;
                    }
                    if (preg_match('/^[a-f0-9]{64}\.min\.' . $type . '\.lock$/', $name) === 1
                        || strpos($name, '.kodety-rocket-') === 0) {
                        // Lock files keep a stable inode for all future users.
                        // A temporary file may still belong to a live builder.
                        continue;
                    }
                    if ($name !== 'index.php') {
                        $success = false;
                        continue;
                    }
                    if (!@unlink($item->getPathname())) {
                        $success = false;
                    }
                }
            } catch (\Throwable $exception) {
                $success = false;
            }
            if (is_dir($directory) && self::directoryIsEmpty($directory) && !@rmdir($directory)) {
                $success = false;
            }
        }

        if (is_dir($root) && self::directoryIsEmpty($root) && !@rmdir($root)) {
            $success = false;
        }

        return $success;
    }

    /**
     * Removes one immutable asset only while owning its persistent lock.
     *
     * A cutoff is supplied by automatic maintenance. Explicit lifecycle purge
     * passes null, but still fails open when another worker owns the asset.
     */
    private static function removeAsset(string $path, string $type, ?int $cutoff): bool
    {
        if (preg_match('/^[a-f0-9]{64}\.min\.' . preg_quote($type, '/') . '$/', basename($path)) !== 1
            || is_link($path)
            || !self::directoryIsSafe(dirname($path))) {
            return false;
        }

        $lock = self::openLock($path . '.lock');
        if ($lock === false) {
            return false;
        }

        try {
            if (!@flock($lock, LOCK_EX | LOCK_NB)) {
                return false;
            }

            clearstatcache(true, $path);
            if (!file_exists($path) && !is_link($path)) {
                return true;
            }
            if (!is_file($path) || is_link($path) || !self::directoryIsSafe(dirname($path))) {
                return false;
            }

            $modified = @filemtime($path);
            if (!is_int($modified) || ($cutoff !== null && $modified >= $cutoff)) {
                return false;
            }

            return @unlink($path);
        } finally {
            @flock($lock, LOCK_UN);
            @fclose($lock);
        }
    }

    /** @return resource|false */
    private static function openLock(string $path)
    {
        if (preg_match('/^[a-f0-9]{64}\.min\.(?:css|js)\.lock$/', basename($path)) !== 1
            || is_link($path)
            || !self::directoryIsSafe(dirname($path))) {
            return false;
        }

        $handle = @fopen($path, 'x+b');
        if ($handle === false) {
            if (!is_file($path) || is_link($path)) {
                return false;
            }
            $handle = @fopen($path, 'c+b');
        }
        if ($handle === false || !self::openedFileMatchesPath($handle, $path)) {
            if (is_resource($handle)) {
                @fclose($handle);
            }

            return false;
        }

        return $handle;
    }

    /** @param resource $handle */
    private static function openedFileMatchesPath($handle, string $path): bool
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

    private static function directoryIsEmpty(string $directory): bool
    {
        if (!self::directoryIsSafe($directory)) {
            return false;
        }

        try {
            $iterator = new \FilesystemIterator($directory, \FilesystemIterator::SKIP_DOTS);

            return !$iterator->valid();
        } catch (\Throwable $exception) {
            return false;
        }
    }

    private static function directory(?int $blogId): ?string
    {
        if (!defined('WP_CONTENT_DIR')) {
            return null;
        }
        $content = rtrim(str_replace('\\', '/', (string) WP_CONTENT_DIR), '/');
        if ($content === '' || $content === '/') {
            return null;
        }
        $blogId = $blogId ?? (function_exists('get_current_blog_id') ? (int) get_current_blog_id() : 1);

        return $content . '/cache/kodety-rocket/' . max(1, $blogId) . '/assets';
    }

    private static function directoryIsSafe(string $directory): bool
    {
        if (!defined('WP_CONTENT_DIR') || is_link($directory) || !is_dir($directory)) {
            return false;
        }
        $content = rtrim(str_replace('\\', '/', (string) WP_CONTENT_DIR), '/');
        $directory = rtrim(str_replace('\\', '/', $directory), '/');
        $prefix = $content . '/cache/kodety-rocket/';
        if (strpos($directory . '/', $prefix) !== 0
            || preg_match('#^' . preg_quote($prefix, '#') . '[1-9][0-9]*/assets(?:/(?:css|js))?$#D', $directory) !== 1) {
            return false;
        }

        $relative = substr($directory, strlen($content) + 1);
        $current = $content;
        foreach (explode('/', $relative) as $segment) {
            $current .= '/' . $segment;
            if (is_link($current) || (file_exists($current) && !is_dir($current))) {
                return false;
            }
        }

        $contentReal = realpath($content);
        $directoryReal = realpath($directory);
        if ($contentReal === false || $directoryReal === false) {
            return false;
        }
        $contentReal = rtrim(str_replace('\\', '/', $contentReal), '/');
        $directoryReal = rtrim(str_replace('\\', '/', $directoryReal), '/');

        return $directoryReal === $contentReal || strpos($directoryReal . '/', $contentReal . '/') === 0;
    }
}
