<?php

declare(strict_types=1);

namespace KodetyRocket\Diagnostics;

use KodetyRocket\Settings\SettingsRepository;

/** A small, dependency-free and privacy-conscious JSONL diagnostic logger. */
final class Logger
{
    private const MAX_STRING_BYTES = 1000;
    private const MAX_CONTEXT_ITEMS = 100;

    private ?SettingsRepository $settings;

    public function __construct(?SettingsRepository $settings = null)
    {
        $this->settings = $settings;
    }

    /** @param array<string, mixed> $context */
    public function info(string $message, array $context = []): void
    {
        $this->write('info', $message, $context);
    }

    /** @param array<string, mixed> $context */
    public function warning(string $message, array $context = []): void
    {
        $this->write('warning', $message, $context);
    }

    /** @param array<string, mixed> $context */
    public function error(string $message, array $context = []): void
    {
        $this->write('error', $message, $context);
    }

    /** @param array<string, mixed> $context */
    public function write(string $level, string $message, array $context = []): void
    {
        if (!$this->enabled()) {
            return;
        }

        try {
            $path = $this->path();
            $directory = dirname($path);
            if (!$this->ensureDirectory($directory)) {
                return;
            }

            $record = [
                'timestamp' => gmdate('c'),
                'level' => in_array($level, ['info', 'warning', 'error'], true) ? $level : 'info',
                'event' => $this->cleanString($message),
                'context' => $this->sanitizeContext($context),
                'blog_id' => function_exists('get_current_blog_id') ? (int) get_current_blog_id() : 1,
            ];

            $json = function_exists('wp_json_encode')
                ? wp_json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
                : json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

            if (!is_string($json)) {
                return;
            }

            $handle = $this->openLogFile($path);
            if ($handle === false) {
                return;
            }

            if (@flock($handle, LOCK_EX)) {
                @fseek($handle, 0, SEEK_END);
                @fwrite($handle, $json . "\n");
                @fflush($handle);
                @flock($handle, LOCK_UN);
            }
            @fclose($handle);
            $this->prune();
        } catch (\Throwable $exception) {
            // Diagnostics must never affect a visitor request.
        }
    }

    public function path(): string
    {
        return $this->directory() . '/diagnostics-' . gmdate('Y-m-d') . '.jsonl';
    }

    /** @return list<array<string, mixed>> */
    public function recent(int $limit = 100): array
    {
        $limit = max(1, min(500, $limit));
        $directory = $this->directory();
        if (!$this->storageDirectoryIsSafe($directory)) {
            return [];
        }
        $files = glob($directory . '/diagnostics-*.jsonl') ?: [];
        rsort($files, SORT_STRING);
        $records = [];

        foreach ($files as $file) {
            foreach (array_reverse($this->tailLines($file, $limit)) as $line) {
                $decoded = json_decode($line, true);
                if (is_array($decoded)) {
                    $records[] = $decoded;
                }
                if (count($records) >= $limit) {
                    break 2;
                }
            }
        }

        return $records;
    }

    public function clear(): bool
    {
        $directory = $this->directory();
        if (!is_dir($directory)) {
            return !is_link($directory);
        }
        if (!$this->storageDirectoryIsSafe($directory)) {
            return false;
        }

        $success = true;
        foreach (glob($directory . '/diagnostics-*.jsonl') ?: [] as $file) {
            if (is_link($file)) {
                $success = false;
            } elseif (is_file($file) && !@unlink($file)) {
                $success = false;
            }
        }

        return $success;
    }

    public function purgeStorage(): bool
    {
        $directory = $this->directory();
        if (!is_dir($directory)) {
            return !is_link($directory);
        }
        if (!$this->storageDirectoryIsSafe($directory)) {
            return false;
        }

        $success = $this->clear();
        foreach (['index.php', '.htaccess', 'web.config'] as $filename) {
            $path = $directory . '/' . $filename;
            if (is_file($path) && !@unlink($path)) {
                $success = false;
            }
        }
        if (is_dir($directory) && !@rmdir($directory)) {
            $success = false;
        }

        return $success;
    }

    private function enabled(): bool
    {
        return $this->settings === null || (bool) $this->settings->get('diagnostics_enabled', false);
    }

    private function directory(): string
    {
        $baseDirectory = $this->baseDirectory();

        $siteIdentity = function_exists('home_url') ? (string) home_url('/') : 'wordpress';
        if (defined('AUTH_SALT')) {
            $siteIdentity .= '|' . (string) AUTH_SALT;
        }
        $siteHash = substr(hash('sha256', $siteIdentity), 0, 20);
        $blogId = function_exists('get_current_blog_id') ? max(1, (int) get_current_blog_id()) : 1;

        $directory = rtrim($baseDirectory, '/\\') . '/' . $siteHash . '/' . $blogId;
        if (function_exists('apply_filters')) {
            $filtered = apply_filters('kodety_rocket_log_directory', $directory, $blogId);
            if (is_string($filtered) && $filtered !== '') {
                $directory = $filtered;
            }
        }

        return rtrim($directory, '/\\');
    }

    private function baseDirectory(): string
    {
        if (defined('KODETY_ROCKET_LOG_DIR') && is_string(KODETY_ROCKET_LOG_DIR) && KODETY_ROCKET_LOG_DIR !== '') {
            return rtrim((string) KODETY_ROCKET_LOG_DIR, '/\\');
        }
        if (function_exists('get_temp_dir')) {
            return rtrim((string) get_temp_dir(), '/\\') . '/kodety-rocket-logs';
        }

        return rtrim(sys_get_temp_dir(), '/\\') . '/kodety-rocket-logs';
    }

    private function ensureDirectory(string $directory): bool
    {
        if (!$this->isSafeStorageDirectory($directory) || is_link($directory)) {
            return false;
        }

        $created = is_dir($directory);
        $base = rtrim(str_replace('\\', '/', $this->baseDirectory()), '/');
        $normalized = rtrim(str_replace('\\', '/', $directory), '/');
        if (!$created && ($normalized === $base || strpos($normalized . '/', $base . '/') === 0)) {
            if (!is_dir($base)) {
                if (is_link($base)) {
                    return false;
                }
                $baseCreated = function_exists('wp_mkdir_p')
                    ? (bool) wp_mkdir_p($base)
                    : (@mkdir($base, 0700, true) || is_dir($base));
                if (!$baseCreated || !is_dir($base) || is_link($base)) {
                    return false;
                }
            }
            $current = $base;
            $relative = ltrim(substr($normalized, strlen($base)), '/');
            foreach ($relative === '' ? [] : explode('/', $relative) as $segment) {
                $current .= '/' . $segment;
                if (is_link($current)) {
                    return false;
                }
                if (!is_dir($current) && !@mkdir($current, 0700)) {
                    return false;
                }
            }
            $created = is_dir($directory);
        } elseif (!$created && function_exists('wp_mkdir_p')) {
            // An explicitly filtered directory is trusted configuration, but
            // its final component is still required to be a real directory.
            $created = (bool) wp_mkdir_p($directory);
        } elseif (!$created) {
            $created = @mkdir($directory, 0700, true) || is_dir($directory);
        }
        if (!$created || !is_dir($directory) || is_link($directory) || !$this->storageDirectoryIsSafe($directory)) {
            return false;
        }

        @chmod($directory, 0700);

        return !$this->isBelowWebRoot($directory) || $this->protectDirectory($directory);
    }

    private function isSafeStorageDirectory(string $directory): bool
    {
        $normalized = rtrim(str_replace('\\', '/', trim($directory)), '/');
        if ($normalized === '' || $normalized === '.' || preg_match('~^[A-Za-z]:$~', $normalized) === 1) {
            return false;
        }

        $forbidden = ['/'];
        foreach (['ABSPATH', 'WP_CONTENT_DIR'] as $constant) {
            if (defined($constant)) {
                $forbidden[] = rtrim(str_replace('\\', '/', (string) constant($constant)), '/');
            }
        }
        $temporaryRoot = rtrim(str_replace('\\', '/', sys_get_temp_dir()), '/');
        if ($temporaryRoot !== '') {
            $forbidden[] = $temporaryRoot;
        }

        if (in_array($normalized, array_unique($forbidden), true)) {
            return false;
        }

        $resolved = realpath($directory);
        if ($resolved !== false) {
            $resolved = rtrim(str_replace('\\', '/', $resolved), '/');
            $resolvedForbidden = [];
            foreach (array_unique($forbidden) as $candidate) {
                $candidateReal = realpath($candidate);
                $resolvedForbidden[] = $candidateReal === false
                    ? rtrim(str_replace('\\', '/', $candidate), '/')
                    : rtrim(str_replace('\\', '/', $candidateReal), '/');
            }
            if (in_array($resolved, array_unique($resolvedForbidden), true)) {
                return false;
            }
        }

        return true;
    }

    private function storageDirectoryIsSafe(string $directory): bool
    {
        if (!is_dir($directory) || is_link($directory)) {
            return false;
        }
        $directory = rtrim(str_replace('\\', '/', $directory), '/');
        $base = rtrim(str_replace('\\', '/', $this->baseDirectory()), '/');
        if ($directory !== $base && strpos($directory . '/', $base . '/') !== 0) {
            // The filter is trusted to relocate logs. The leaf must still be a
            // real directory; paths under the normal base receive the stricter
            // per-segment verification below.
            return realpath($directory) !== false;
        }
        if (!is_dir($base) || is_link($base)) {
            return false;
        }

        $current = $base;
        $relative = ltrim(substr($directory, strlen($base)), '/');
        foreach ($relative === '' ? [] : explode('/', $relative) as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                return false;
            }
            $current .= '/' . $segment;
            if (is_link($current) || !is_dir($current)) {
                return false;
            }
        }

        $baseReal = realpath($base);
        $directoryReal = realpath($directory);
        if ($baseReal === false || $directoryReal === false) {
            return false;
        }
        $baseReal = rtrim(str_replace('\\', '/', $baseReal), '/');
        $directoryReal = rtrim(str_replace('\\', '/', $directoryReal), '/');

        return $directoryReal === $baseReal || strpos($directoryReal . '/', $baseReal . '/') === 0;
    }

    /** @return resource|false */
    private function openLogFile(string $path)
    {
        if (is_link($path) || !$this->storageDirectoryIsSafe(dirname($path))) {
            return false;
        }
        $handle = @fopen($path, 'x+b');
        if ($handle === false) {
            if (!is_file($path) || is_link($path)) {
                return false;
            }
            $handle = @fopen($path, 'c+b');
        }
        if ($handle === false) {
            return false;
        }
        if (is_link($path)
            || !$this->storageDirectoryIsSafe(dirname($path))
            || !$this->openedFileMatchesPath($handle, $path)) {
            @fclose($handle);

            return false;
        }

        return $handle;
    }

    private function isBelowWebRoot(string $directory): bool
    {
        $directory = rtrim(str_replace('\\', '/', $directory), '/') . '/';
        foreach (['ABSPATH', 'WP_CONTENT_DIR'] as $constant) {
            if (!defined($constant)) {
                continue;
            }
            $root = rtrim(str_replace('\\', '/', (string) constant($constant)), '/') . '/';
            if ($root !== '/' && strpos($directory, $root) === 0) {
                return true;
            }
        }

        return false;
    }

    private function protectDirectory(string $directory): bool
    {
        $files = [
            'index.php' => "<?php\n// Silence is golden.\n",
            '.htaccess' => "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n",
            'web.config' => "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<configuration><system.webServer><security><authorization><remove users=\"*\" roles=\"\" verbs=\"\"/><add accessType=\"Deny\" users=\"*\"/></authorization></security></system.webServer></configuration>\n",
        ];

        foreach ($files as $filename => $contents) {
            $path = $directory . '/' . $filename;
            if (is_link($path)) {
                return false;
            }
            if (is_file($path)) {
                $existing = @file_get_contents($path);
                if (is_string($existing) && hash_equals($contents, $existing)) {
                    continue;
                }

                return false;
            }
            $handle = @fopen($path, 'x+b');
            if ($handle === false) {
                $existing = @file_get_contents($path);
                if (is_string($existing) && hash_equals($contents, $existing)) {
                    continue;
                }

                return false;
            }
            if (!$this->openedFileMatchesPath($handle, $path)) {
                @fclose($handle);

                return false;
            }
            $written = @fwrite($handle, $contents);
            @fflush($handle);
            if (function_exists('fsync')) {
                @fsync($handle);
            }
            @fclose($handle);
            @chmod($path, 0600);
            if ($written !== strlen($contents)) {
                @unlink($path);

                return false;
            }
        }

        return true;
    }

    /** @param mixed $value
     *  @return mixed
     */
    private function sanitizeValue($value, string $key, int $depth = 0)
    {
        if (preg_match('/pass(word)?|secret|token|authorization|cookie|nonce|api[_-]?key/i', $key) === 1) {
            return '[redacted]';
        }

        if (is_string($value) && preg_match('/(?:^|[_-])(?:absolute[_-]?)?(?:path|source|file|filename|dir|directory|root)(?:$|[_-])/i', $key) === 1) {
            return '[path redacted]';
        }

        if ($depth > 3) {
            return '[truncated]';
        }

        if (is_array($value)) {
            $clean = [];
            $count = 0;
            foreach ($value as $childKey => $childValue) {
                if (++$count > self::MAX_CONTEXT_ITEMS) {
                    $clean['_truncated'] = true;
                    break;
                }
                $cleanKey = substr(preg_replace('/[^a-zA-Z0-9_.-]/', '_', (string) $childKey) ?: 'item', 0, 80);
                $clean[$cleanKey] = $this->sanitizeValue($childValue, $cleanKey, $depth + 1);
            }

            return $clean;
        }

        if (is_object($value)) {
            if ($value instanceof \Throwable) {
                return [
                    'type' => get_class($value),
                    'message' => $this->cleanString($value->getMessage()),
                ];
            }

            return '[object ' . get_class($value) . ']';
        }

        if (is_resource($value)) {
            return '[resource]';
        }

        if (is_string($value)) {
            if (preg_match('/^(https?:\/\/)/i', $value) === 1) {
                $parts = parse_url($value);
                if (is_array($parts)) {
                    $value = ($parts['scheme'] ?? 'https') . '://' . ($parts['host'] ?? '') . ($parts['path'] ?? '/');
                }
            }

            if (preg_match('/^(?:\d{1,3}\.){3}\d{1,3}$/', $value) === 1) {
                return 'sha256:' . substr(hash('sha256', $value), 0, 16);
            }

            return $this->cleanString($value);
        }

        return is_scalar($value) || $value === null ? $value : '[unsupported]';
    }

    /** @param array<string, mixed> $context
     *  @return array<string, mixed>
     */
    private function sanitizeContext(array $context): array
    {
        $value = $this->sanitizeValue($context, 'context');

        return is_array($value) ? $value : [];
    }

    private function cleanString(string $value): string
    {
        $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
        $value = preg_replace('~\bfile:///?[^\s]+~i', '[path redacted]', $value) ?? $value;
        $value = preg_replace('~(?<![A-Za-z0-9:/])(?:/[A-Za-z0-9._-]+){2,}(?:/[A-Za-z0-9._-]+)?~', '[path redacted]', $value) ?? $value;
        $value = preg_replace('~\b[A-Za-z]:[\\\\/](?:[^\s:]+[\\\\/])+[^\s:]*~', '[path redacted]', $value) ?? $value;
        if (function_exists('sanitize_text_field')) {
            $value = sanitize_text_field($value);
        } else {
            $value = trim(strip_tags($value));
        }

        return function_exists('mb_substr')
            ? mb_substr($value, 0, self::MAX_STRING_BYTES)
            : substr($value, 0, self::MAX_STRING_BYTES);
    }

    /** @return list<string> */
    private function tailLines(string $file, int $limit): array
    {
        if (is_link($file) || !$this->storageDirectoryIsSafe(dirname($file))) {
            return [];
        }
        $size = @filesize($file);
        if (!is_int($size) || $size <= 0) {
            return [];
        }

        $bytes = min($size, 2 * 1024 * 1024);
        $handle = @fopen($file, 'rb');
        if ($handle === false) {
            return [];
        }
        if (!$this->openedFileMatchesPath($handle, $file)
            || !$this->storageDirectoryIsSafe(dirname($file))) {
            @fclose($handle);

            return [];
        }

        @fseek($handle, -$bytes, SEEK_END);
        $data = @fread($handle, $bytes);
        @fclose($handle);
        if (!is_string($data)) {
            return [];
        }

        $lines = array_values(array_filter(explode("\n", $data), static fn (string $line): bool => trim($line) !== ''));

        return array_slice($lines, -$limit);
    }

    private function prune(): void
    {
        if (!$this->storageDirectoryIsSafe($this->directory())) {
            return;
        }
        $days = $this->settings ? (int) $this->settings->get('log_retention_days', 7) : 7;
        $dayInSeconds = defined('DAY_IN_SECONDS') ? (int) DAY_IN_SECONDS : 86400;
        $cutoff = time() - max(1, $days) * $dayInSeconds;

        $directory = $this->directory();
        foreach (glob($directory . '/diagnostics-*.jsonl') ?: [] as $file) {
            if (is_link($file) || !$this->storageDirectoryIsSafe($directory)) {
                continue;
            }
            $modified = @filemtime($file);
            if (is_int($modified) && $modified < $cutoff) {
                @unlink($file);
            }
        }
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
}
