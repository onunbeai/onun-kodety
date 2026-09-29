<?php

declare(strict_types=1);

namespace KodetyRocket\Preload;

use KodetyRocket\Cache\FileCacheStore;
use KodetyRocket\Diagnostics\Logger;
use KodetyRocket\Settings\SettingsRepository;

/** Warms public pages through small, resumable WP-Cron batches. */
final class Preloader
{
    public const HOOK = 'kodety_rocket_preload_batch';
    public const ENQUEUE_HOOK = 'kodety_rocket_preload_enqueue_retry';
    public const STATE_OPTION = 'kodety_rocket_preload_state';
    public const LOCK_OPTION = 'kodety_rocket_preload_lock_v2';
    public const PENDING_OPTION = 'kodety_rocket_preload_pending_v2';
    public const PENDING_LOCK_OPTION = 'kodety_rocket_preload_pending_lock_v2';
    public const GENERATION_OPTION = 'kodety_rocket_preload_generation_v2';
    private const LOCK_TRANSIENT = 'kodety_rocket_preload_lock';
    private const MAX_URLS = 500;

    private SettingsRepository $settings;
    private FileCacheStore $cache;
    private Logger $logger;
    /** @var array<string, string> */
    private array $ownedOptionLocks = [];
    private bool $transientLockOwned = false;

    public function __construct(SettingsRepository $settings, FileCacheStore $cache, Logger $logger)
    {
        $this->settings = $settings;
        $this->cache = $cache;
        $this->logger = $logger;
    }

    public function register(): void
    {
        if (!function_exists('add_action')) {
            return;
        }

        add_action(self::HOOK, [$this, 'run']);
        add_action(self::ENQUEUE_HOOK, [$this, 'retryEnqueue'], 10, 3);
        add_action('init', [$this, 'maybeSchedule'], 30);
    }

    /** @param list<string> $urls */
    public function schedule(array $urls = [], bool $manual = false): bool
    {
        if (!function_exists('update_option') || !function_exists('wp_schedule_single_event')) {
            return false;
        }

        $urls = $urls === [] ? $this->discoverUrls() : $this->sanitizeUrls($urls);
        if ($urls === []) {
            return false;
        }

        $generation = $this->currentGeneration();
        if (!$this->acquireLock()) {
            $persisted = $this->appendPending($urls, $manual, $generation)
                || $this->deferPending($urls, $manual, $generation, 10);

            return $persisted && $this->scheduleNext(5);
        }

        try {
            $pending = $this->pendingSnapshot($generation);
            $storedState = $this->rawState();
            if (($storedState['generation'] ?? '') === $generation
                && in_array($storedState['status'] ?? '', ['queued', 'running'], true)) {
                $existing = isset($storedState['queue']) && is_array($storedState['queue'])
                    ? $this->sanitizeUrls(array_values($storedState['queue']))
                    : [];
                $queue = array_slice(
                    array_values(array_unique(array_merge($existing, $urls, $pending['urls']))),
                    0,
                    self::MAX_URLS
                );
                $state = $storedState;
                $state['status'] = 'queued';
                $state['queue'] = $queue;
                $state['manual'] = !empty($state['manual']) || $manual || $pending['manual'];
                $state['total'] = max(
                    (int) ($state['total'] ?? 0),
                    (int) ($state['processed'] ?? 0) + count($queue)
                );
                $state['updated_at'] = time();
                $state['completed_at'] = null;
            } else {
                $urls = array_slice(array_values(array_unique(array_merge($urls, $pending['urls']))), 0, self::MAX_URLS);
                $state = $this->freshState($urls, $generation, $manual || $pending['manual']);
            }
            if (!$this->saveState($state)) {
                return false;
            }
            $this->ackPending($pending, $generation);
            if (!$this->scheduleNext(5)) {
                $state['status'] = 'error';
                $state['last_error'] = 'cron_schedule_failed';
                $state['updated_at'] = time();
                $this->saveState($state);

                return false;
            }

            return true;
        } finally {
            $this->releaseLock();
        }
    }

    /** @param list<string> $urls */
    public function enqueue(array $urls): bool
    {
        $urls = $this->sanitizeUrls($urls);
        if ($urls === [] || !function_exists('get_option') || !function_exists('update_option')) {
            return false;
        }

        $generation = $this->currentGeneration();
        $persisted = $this->appendPending($urls, false, $generation)
            || $this->deferPending($urls, false, $generation, 10);

        return $persisted && $this->scheduleNext(5);
    }

    /** @param mixed $urls
     *  @param mixed $manual
     *  @param mixed $generation
     */
    public function retryEnqueue($urls = [], $manual = false, $generation = ''): void
    {
        $urls = is_array($urls) ? $this->sanitizeUrls($urls) : [];
        $generation = is_string($generation) ? $generation : '';
        $currentGeneration = $this->storedGeneration();
        if ($urls === [] || $generation === '' || $currentGeneration === null
            || !hash_equals($currentGeneration, $generation)) {
            return;
        }

        if (!$this->appendPending($urls, (bool) $manual, $generation)) {
            $this->deferPending($urls, (bool) $manual, $generation, 30);

            return;
        }

        $this->scheduleNext(5);
    }

    public function maybeSchedule(): void
    {
        if ((defined('KODETY_ROCKET_BYPASS') && (bool) KODETY_ROCKET_BYPASS)
            || !function_exists('wp_next_scheduled')) {
            return;
        }

        $state = $this->rawState();
        $generation = $this->currentGeneration();
        $pending = $this->pendingForGeneration($generation);
        $automaticEnabled = (bool) $this->settings->get('preload_enabled', false);
        $manualQueued = (($state['generation'] ?? $generation) === $generation
            && !empty($state['manual'])
            && in_array($state['status'] ?? '', ['queued', 'running'], true));
        $manualPending = $pending['manual'] && $pending['urls'] !== [];
        if (!$automaticEnabled && !$manualQueued && !$manualPending) {
            return;
        }
        $nextRun = wp_next_scheduled(self::HOOK);
        if ($nextRun) {
            return;
        }

        if ($pending['urls'] !== []) {
            $this->scheduleNext(5);

            return;
        }

        if (($state['generation'] ?? $generation) === $generation
            && in_array($state['status'] ?? '', ['queued', 'running'], true)) {
            // Recover a batch after a cron event was lost or a worker died.
            // Do not rewrite the snapshot read above: schedule()/run() own the
            // state lock and may have committed a newer queue meanwhile.
            $this->scheduleNext(30);

            return;
        }

        $completed = (int) ($state['completed_at'] ?? 0);
        $ttl = (int) $this->settings->get('page_cache_ttl', 3600);
        if (($state['status'] ?? '') === 'error' && (int) ($state['updated_at'] ?? 0) > time() - 15 * 60) {
            return;
        }
        if ($automaticEnabled && ($completed === 0 || $completed <= time() - $ttl)) {
            $this->schedule();
        }
    }

    public function run(): void
    {
        if (defined('KODETY_ROCKET_BYPASS') && (bool) KODETY_ROCKET_BYPASS) {
            return;
        }

        if (!$this->acquireLock()) {
            $generation = $this->storedGeneration();
            if ($generation === null) {
                return;
            }
            $state = $this->rawState();
            $pending = $this->pendingForGeneration($generation);
            $stateIsCurrent = ($state['generation'] ?? $generation) === $generation;
            $stateCanRun = $stateIsCurrent
                && in_array($state['status'] ?? '', ['queued', 'running'], true)
                && (!empty($state['manual']) || (bool) $this->settings->get('preload_enabled', false));
            $pendingCanRun = $pending['urls'] !== []
                && ($pending['manual'] || (bool) $this->settings->get('preload_enabled', false));
            if ($stateCanRun || $pendingCanRun) {
                $this->scheduleNext(30);
            }
            return;
        }

        $generation = null;
        $state = [];

        try {
            $state = $this->rawState();
            $generation = $this->storedGeneration();
            if ($generation === null) {
                if ($state === [] || isset($state['generation'])) {
                    if ($state !== [] && function_exists('delete_option')) {
                        delete_option(self::STATE_OPTION);
                    }
                    return;
                }
                // One-time migration for work queued before generation tokens
                // existed. An empty state after uninstall must never recreate it.
                $generation = $this->currentGeneration();
            }
            $stateNeedsPersistence = false;
            if (!isset($state['generation']) && $state !== []) {
                // Safe migration from the pre-generation state schema.
                $state['generation'] = $generation;
                $stateNeedsPersistence = true;
            }

            $pending = $this->pendingSnapshot($generation);
            if (($state['generation'] ?? '') !== $generation) {
                if ($pending['urls'] === []) {
                    return;
                }
                $state = $this->freshState($pending['urls'], $generation, $pending['manual']);
                $stateNeedsPersistence = true;
            } elseif ($pending['urls'] !== []) {
                if (!in_array($state['status'] ?? '', ['queued', 'running'], true)) {
                    $state = $this->freshState($pending['urls'], $generation, $pending['manual']);
                } else {
                    $existing = isset($state['queue']) && is_array($state['queue'])
                        ? $this->sanitizeUrls(array_values($state['queue']))
                        : [];
                    $state['queue'] = array_slice(array_values(array_unique(array_merge($existing, $pending['urls']))), 0, self::MAX_URLS);
                    $state['manual'] = !empty($state['manual']) || $pending['manual'];
                    $state['total'] = max(
                        (int) ($state['total'] ?? 0),
                        (int) ($state['processed'] ?? 0) + count($state['queue'])
                    );
                }
                $stateNeedsPersistence = true;
            }

            if (!in_array($state['status'] ?? '', ['queued', 'running'], true)
                || !$this->workerMayContinue($state, $generation)) {
                return;
            }
            if ($stateNeedsPersistence) {
                if (!$this->saveWorkerState($state, $generation)) {
                    return;
                }
                $this->ackPending($pending, $generation);
            }

            $queue = isset($state['queue']) && is_array($state['queue'])
                ? $this->sanitizeUrls(array_values($state['queue']))
                : [];
            if ($queue === []) {
                $state['status'] = 'complete';
                $state['completed_at'] = time();
                $state['updated_at'] = time();
                $this->saveWorkerState($state, $generation);
                return;
            }

            $batchSize = (int) $this->settings->get('preload_batch_size', 5);
            $batch = array_splice($queue, 0, max(1, min(25, $batchSize)));
            $state['status'] = 'running';
            $batchStartedAt = microtime(true);

            while ($batch !== []) {
                if (!$this->workerMayContinue($state, $generation)) {
                    return;
                }
                if (microtime(true) - $batchStartedAt >= 12.0) {
                    $queue = array_merge($batch, $queue);
                    break;
                }

                $url = (string) array_shift($batch);
                $success = $this->request((string) $url);
                $state['processed'] = (int) ($state['processed'] ?? 0) + 1;
                if (!$success) {
                    $state['failed'] = (int) ($state['failed'] ?? 0) + 1;
                }

                // Checkpoint after every URL. A worker killed mid-request can
                // repeat at most that one idempotent GET, never a whole batch.
                $state['queue'] = array_merge($batch, $queue);
                $state['updated_at'] = time();
                if (!$this->saveWorkerState($state, $generation)) {
                    return;
                }
            }

            $pending = $this->pendingSnapshot($generation);
            if ($pending['urls'] !== []) {
                $queue = array_slice(array_values(array_unique(array_merge($queue, $pending['urls']))), 0, self::MAX_URLS);
                $state['manual'] = !empty($state['manual']) || $pending['manual'];
                $state['total'] = max(
                    (int) ($state['total'] ?? 0),
                    (int) ($state['processed'] ?? 0) + count($queue)
                );
            }
            $state['queue'] = $queue;
            $state['updated_at'] = time();
            if ($queue === []) {
                $state['status'] = 'complete';
                $state['completed_at'] = time();
            }
            if (!$this->saveWorkerState($state, $generation)) {
                return;
            }
            $this->ackPending($pending, $generation);

            if ($queue !== [] && $this->workerMayContinue($state, $generation)) {
                $this->scheduleNext(20);
            }
        } catch (\Throwable $exception) {
            $this->logger->error('Preload batch failed open.', ['exception' => $exception]);
            if ($state !== [] && is_string($generation) && $this->workerMayContinue($state, $generation)) {
                $state['status'] = 'queued';
                $state['last_error'] = 'batch_failed_open';
                $state['updated_at'] = time();
                if ($this->saveWorkerState($state, $generation)) {
                    $this->scheduleNext(60);
                }
            }
        } finally {
            $this->releaseLock();
        }
    }

    public function unschedule(): void
    {
        self::cancelStoredWork();
    }

    /**
     * Invalidates active workers without stealing their ownership locks.
     * Lifecycle handlers use the same cancellation path as the settings UI.
     */
    public static function cancelStoredWork(): void
    {
        $generation = self::lockToken();
        if (function_exists('update_option')) {
            update_option(self::GENERATION_OPTION, $generation, false);
        }
        if (function_exists('wp_clear_scheduled_hook')) {
            wp_clear_scheduled_hook(self::HOOK);
            wp_clear_scheduled_hook(self::ENQUEUE_HOOK);
        }
        if (function_exists('get_option') && function_exists('update_option')) {
            $stored = get_option(self::STATE_OPTION, []);
            $state = is_array($stored) ? $stored : [];
            $state['status'] = 'paused';
            $state['generation'] = $generation;
            $state['manual'] = false;
            $state['updated_at'] = time();
            update_option(self::STATE_OPTION, $state, false);
        }
        if (function_exists('delete_option')) {
            // A concurrent append carrying the old generation is harmless and
            // will be ignored, even if it lands immediately after this delete.
            delete_option(self::PENDING_OPTION);
        }
    }

    /** @return array<string, int|string|null> */
    public function status(): array
    {
        $state = $this->rawState();
        $generation = $this->currentGeneration();
        $pending = $this->pendingForGeneration($generation);
        $queue = (($state['generation'] ?? $generation) === $generation
            && isset($state['queue'])
            && is_array($state['queue'])) ? $state['queue'] : [];

        return [
            'status' => is_string($state['status'] ?? null) ? $state['status'] : 'idle',
            'total' => (int) ($state['total'] ?? 0),
            'processed' => (int) ($state['processed'] ?? 0),
            'failed' => (int) ($state['failed'] ?? 0),
            'remaining' => count(array_unique(array_merge($queue, $pending['urls']))),
            'started_at' => isset($state['started_at']) ? (int) $state['started_at'] : null,
            'updated_at' => isset($state['updated_at']) ? (int) $state['updated_at'] : null,
            'completed_at' => isset($state['completed_at']) && $state['completed_at'] !== null ? (int) $state['completed_at'] : null,
            'next_run' => function_exists('wp_next_scheduled') ? (wp_next_scheduled(self::HOOK) ?: null) : null,
        ];
    }

    /** @return list<string> */
    private function discoverUrls(): array
    {
        $urls = [];
        if (function_exists('home_url')) {
            $urls[] = (string) home_url('/');
        }

        if (!function_exists('get_posts') || !function_exists('get_permalink')) {
            return $this->sanitizeUrls($urls);
        }

        $postTypes = function_exists('get_post_types')
            ? array_values(array_diff((array) get_post_types(['public' => true], 'names'), ['attachment']))
            : ['post', 'page'];
        $ids = get_posts([
            'post_type' => $postTypes,
            'post_status' => 'publish',
            'posts_per_page' => self::MAX_URLS - 1,
            'fields' => 'ids',
            'orderby' => 'modified',
            'order' => 'DESC',
            'no_found_rows' => true,
            'suppress_filters' => false,
        ]);

        foreach (is_array($ids) ? $ids : [] as $id) {
            $url = get_permalink((int) $id);
            if (is_string($url) && $url !== '') {
                $urls[] = $url;
            }
        }

        return $this->sanitizeUrls($urls);
    }

    /** @param list<string> $urls
     *  @return list<string>
     */
    private function sanitizeUrls(array $urls): array
    {
        $homeOrigin = function_exists('home_url') ? $this->origin((string) home_url('/')) : null;
        $clean = [];

        foreach ($urls as $url) {
            if (!is_string($url) || !filter_var($url, FILTER_VALIDATE_URL)) {
                continue;
            }
            $parts = parse_url($url);
            if (!is_array($parts)
                || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
                || $homeOrigin === null
                || $this->origin($url) !== $homeOrigin
                || isset($parts['user'])
                || isset($parts['pass'])) {
                continue;
            }
            unset($parts['fragment']);
            $clean[] = $this->withoutFragment($url);
        }

        return array_slice(array_values(array_unique($clean)), 0, self::MAX_URLS);
    }

    private function origin(string $url): ?string
    {
        $parts = parse_url($url);
        if (!is_array($parts)
            || !isset($parts['scheme'], $parts['host'])
            || isset($parts['user'])
            || isset($parts['pass'])) {
            return null;
        }
        $scheme = strtolower((string) $parts['scheme']);
        if (!in_array($scheme, ['http', 'https'], true)) {
            return null;
        }
        $host = strtolower(rtrim(trim((string) $parts['host'], '[]'), '.'));
        $port = isset($parts['port']) ? (int) $parts['port'] : ($scheme === 'https' ? 443 : 80);

        return $scheme . '://' . $host . ':' . $port;
    }

    private function withoutFragment(string $url): string
    {
        $position = strpos($url, '#');

        return $position === false ? $url : substr($url, 0, $position);
    }

    private function request(string $url): bool
    {
        if (!function_exists('wp_safe_remote_get')) {
            return false;
        }

        $homeOrigin = function_exists('home_url') ? $this->origin((string) home_url('/')) : null;
        if ($homeOrigin === null || $this->origin($url) !== $homeOrigin) {
            return false;
        }

        $currentUrl = $url;
        for ($redirects = 0; $redirects <= 2; ++$redirects) {
            $response = wp_safe_remote_get($currentUrl, [
                'timeout' => 4,
                // Redirects are followed manually only after a same-origin check.
                'redirection' => 0,
                'sslverify' => true,
                'reject_unsafe_urls' => true,
                'user-agent' => 'Kodety Rocket/' . (defined('KODETY_ROCKET_VERSION') ? KODETY_ROCKET_VERSION : '1.0.0') . ' (+https://code.com/)',
                'headers' => [
                    'X-Kodety-Rocket-Preload' => '1',
                    'Accept' => 'text/html,application/xhtml+xml',
                ],
                'limit_response_size' => 2048,
            ]);

            if (function_exists('is_wp_error') && is_wp_error($response)) {
                $this->logger->warning('A preload URL could not be requested.', [
                    'url' => $currentUrl,
                    'error' => $response->get_error_code(),
                ]);

                return false;
            }

            $status = function_exists('wp_remote_retrieve_response_code')
                ? (int) wp_remote_retrieve_response_code($response)
                : 0;
            if ($status >= 200 && $status < 300) {
                return true;
            }
            if ($status < 300 || $status >= 400 || $redirects >= 2) {
                return false;
            }

            $location = $this->responseLocation($response);
            $nextUrl = $this->redirectUrl($currentUrl, $location);
            if ($nextUrl === null || $this->origin($nextUrl) !== $homeOrigin) {
                $this->logger->warning('A preload redirect was rejected.', ['url' => $currentUrl]);

                return false;
            }
            $currentUrl = $nextUrl;
        }

        return false;
    }

    /** @param list<string> $urls
     *  @return array<string, mixed>
     */
    private function freshState(array $urls, string $generation, bool $manual): array
    {
        $now = time();
        $urls = array_slice(array_values(array_unique($urls)), 0, self::MAX_URLS);

        return [
            'status' => 'queued',
            'queue' => $urls,
            'total' => count($urls),
            'processed' => 0,
            'failed' => 0,
            'started_at' => $now,
            'updated_at' => $now,
            'completed_at' => null,
            'generation' => $generation,
            'manual' => $manual,
        ];
    }

    private function currentGeneration(): string
    {
        $current = $this->storedGeneration();
        if ($current !== null) {
            return $current;
        }

        $generation = self::lockToken();
        if (function_exists('add_option') && add_option(self::GENERATION_OPTION, $generation, '', false)) {
            return $generation;
        }

        $current = $this->storedGeneration();
        if ($current !== null) {
            return $current;
        }
        if (function_exists('update_option')) {
            update_option(self::GENERATION_OPTION, $generation, false);
        }

        return $generation;
    }

    private function storedGeneration(): ?string
    {
        $current = function_exists('get_option') ? get_option(self::GENERATION_OPTION, '') : '';

        return is_string($current) && $current !== '' ? $current : null;
    }

    /** @param list<string> $urls */
    private function appendPending(array $urls, bool $manual, string $generation): bool
    {
        if (!function_exists('get_option') || !function_exists('update_option')
            || !$this->acquireOptionLock(self::PENDING_LOCK_OPTION, 60)) {
            return false;
        }

        try {
            $pending = get_option(self::PENDING_OPTION, []);
            if (!is_array($pending) || ($pending['generation'] ?? '') !== $generation) {
                $pending = ['generation' => $generation, 'urls' => [], 'manual' => false];
            }
            $existing = isset($pending['urls']) && is_array($pending['urls'])
                ? $this->sanitizeUrls(array_values($pending['urls']))
                : [];
            $pending['urls'] = array_slice(array_values(array_unique(array_merge($existing, $urls))), 0, self::MAX_URLS);
            $pending['manual'] = !empty($pending['manual']) || $manual;
            $pending['updated_at'] = time();
            $pending['receipt'] = self::lockToken();

            $updated = update_option(self::PENDING_OPTION, $pending, false);
            if ($updated !== false) {
                return true;
            }

            // WordPress also returns false when the stored value is already
            // identical, which is still a successful persistence outcome.
            return get_option(self::PENDING_OPTION, []) === $pending;
        } finally {
            $this->releaseOptionLock(self::PENDING_LOCK_OPTION);
        }
    }

    /** @return array{urls: list<string>, manual: bool, receipt: string} */
    private function pendingSnapshot(string $generation): array
    {
        $pending = function_exists('get_option') ? get_option(self::PENDING_OPTION, []) : [];
        if (!is_array($pending) || ($pending['generation'] ?? '') !== $generation) {
            return ['urls' => [], 'manual' => false, 'receipt' => ''];
        }

        $receipt = isset($pending['receipt']) && is_string($pending['receipt'])
            ? $pending['receipt']
            : 'legacy:' . hash('sha256', serialize($pending));

        return [
            'urls' => isset($pending['urls']) && is_array($pending['urls'])
                ? $this->sanitizeUrls(array_values($pending['urls']))
                : [],
            'manual' => !empty($pending['manual']),
            'receipt' => $receipt,
        ];
    }

    /** @param array{urls: list<string>, manual: bool, receipt: string} $snapshot */
    private function ackPending(array $snapshot, string $generation): bool
    {
        if ($snapshot['receipt'] === '' || !function_exists('get_option')
            || !function_exists('delete_option')
            || !$this->acquireOptionLock(self::PENDING_LOCK_OPTION, 60)) {
            return false;
        }

        try {
            $current = get_option(self::PENDING_OPTION, []);
            if (!is_array($current) || ($current['generation'] ?? '') !== $generation) {
                return false;
            }
            $receipt = isset($current['receipt']) && is_string($current['receipt'])
                ? $current['receipt']
                : 'legacy:' . hash('sha256', serialize($current));
            if (!hash_equals($snapshot['receipt'], $receipt)) {
                return false;
            }

            return delete_option(self::PENDING_OPTION);
        } finally {
            $this->releaseOptionLock(self::PENDING_LOCK_OPTION);
        }
    }

    /** @return array{urls: list<string>, manual: bool} */
    private function pendingForGeneration(string $generation): array
    {
        $pending = $this->pendingSnapshot($generation);

        return ['urls' => $pending['urls'], 'manual' => $pending['manual']];
    }

    /** @param list<string> $urls */
    private function deferPending(array $urls, bool $manual, string $generation, int $delay): bool
    {
        if (!function_exists('wp_schedule_single_event')) {
            return false;
        }

        $args = [$urls, $manual, $generation];
        if (function_exists('wp_next_scheduled') && wp_next_scheduled(self::ENQUEUE_HOOK, $args)) {
            return true;
        }
        $result = wp_schedule_single_event(time() + max(5, $delay), self::ENQUEUE_HOOK, $args, true);
        if (function_exists('wp_next_scheduled') && wp_next_scheduled(self::ENQUEUE_HOOK, $args)) {
            return true;
        }

        return !function_exists('wp_next_scheduled')
            && $result !== false
            && !(function_exists('is_wp_error') && is_wp_error($result));
    }

    /** @param array<string, mixed> $state */
    private function workerMayContinue(array $state, string $generation): bool
    {
        $currentGeneration = $this->storedGeneration();
        if ($currentGeneration === null || !hash_equals($currentGeneration, $generation)) {
            $this->restoreCancelledState($state, $generation);

            return false;
        }

        $bypassed = defined('KODETY_ROCKET_BYPASS') && (bool) KODETY_ROCKET_BYPASS;
        $enabled = !empty($state['manual']) || (bool) $this->settings->get('preload_enabled', false);
        if (!$bypassed && $enabled) {
            return true;
        }

        $state['status'] = 'paused';
        $state['updated_at'] = time();
        $state['generation'] = $generation;
        $this->saveState($state);
        if (function_exists('wp_clear_scheduled_hook')) {
            wp_clear_scheduled_hook(self::HOOK);
        }

        return false;
    }

    /** @param array<string, mixed> $state */
    private function saveWorkerState(array $state, string $generation): bool
    {
        if (!$this->workerMayContinue($state, $generation)) {
            return false;
        }

        $state['generation'] = $generation;
        if (!$this->saveState($state)) {
            $this->scheduleNext(60);

            return false;
        }
        $currentGeneration = $this->storedGeneration();
        if ($currentGeneration === null || !hash_equals($currentGeneration, $generation)) {
            $this->restoreCancelledState($state, $generation);

            return false;
        }
        if (empty($state['manual']) && !(bool) $this->settings->get('preload_enabled', false)) {
            $state['status'] = 'paused';
            $state['updated_at'] = time();
            $this->saveState($state);
            if (function_exists('wp_clear_scheduled_hook')) {
                wp_clear_scheduled_hook(self::HOOK);
            }

            return false;
        }

        return true;
    }

    /** @param array<string, mixed> $workerState */
    private function restoreCancelledState(array $workerState, string $workerGeneration): void
    {
        $currentGeneration = $this->storedGeneration();
        if ($currentGeneration === null) {
            $latest = $this->rawState();
            if (($latest['generation'] ?? '') === $workerGeneration && function_exists('delete_option')) {
                delete_option(self::STATE_OPTION);
            }

            return;
        }
        if (hash_equals($currentGeneration, $workerGeneration)) {
            return;
        }

        $latest = $this->rawState();
        if ($latest === []) {
            // Uninstall may have removed the state after rotating the token.
            // Never recreate plugin data from a cancelled worker.
            return;
        }
        if (($latest['generation'] ?? '') === $currentGeneration
            && ($latest['status'] ?? '') !== 'paused') {
            // A newer schedule won the cancellation race; its state is authoritative.
            return;
        }
        if (($latest['generation'] ?? '') !== $currentGeneration) {
            // A late checkpoint overwrote the cancellation state. Removing the
            // stale generation is safer than reviving it as queued work.
            if (function_exists('delete_option')) {
                delete_option(self::STATE_OPTION);
            }

            return;
        }

        $workerState['status'] = 'paused';
        $workerState['generation'] = $currentGeneration;
        $workerState['manual'] = false;
        $workerState['updated_at'] = time();
        $this->saveState($workerState);
    }

    private function scheduleNext(int $delay): bool
    {
        if (!function_exists('wp_next_scheduled') || !function_exists('wp_schedule_single_event')) {
            return false;
        }
        if (wp_next_scheduled(self::HOOK)) {
            return true;
        }

        $result = wp_schedule_single_event(time() + max(5, $delay), self::HOOK, [], true);
        // Another process may have inserted the same event after our first
        // lookup. WordPress reports that as an error even though work is safe.
        if (wp_next_scheduled(self::HOOK)) {
            return true;
        }

        return false;
    }

    private function acquireLock(): bool
    {
        if (function_exists('add_option') && function_exists('get_option')) {
            return $this->acquireOptionLock(self::LOCK_OPTION, 5 * 60);
        }

        if (!function_exists('get_transient') || !function_exists('set_transient')) {
            return true;
        }
        if (get_transient(self::LOCK_TRANSIENT)) {
            return false;
        }

        $this->transientLockOwned = set_transient(self::LOCK_TRANSIENT, (string) time(), 5 * 60);

        return $this->transientLockOwned;
    }

    private function releaseLock(): void
    {
        if (isset($this->ownedOptionLocks[self::LOCK_OPTION])) {
            $this->releaseOptionLock(self::LOCK_OPTION);
            return;
        }

        if ($this->transientLockOwned && function_exists('delete_transient')) {
            delete_transient(self::LOCK_TRANSIENT);
            $this->transientLockOwned = false;
        }
    }

    private function acquireOptionLock(string $optionName, int $ttl): bool
    {
        if (isset($this->ownedOptionLocks[$optionName])) {
            return true;
        }
        if (!function_exists('add_option') || !function_exists('get_option')) {
            return false;
        }

        $value = self::lockToken() . '|' . (time() + max(30, $ttl));
        if (add_option($optionName, $value, '', false)) {
            $this->ownedOptionLocks[$optionName] = $value;

            return true;
        }

        $existing = get_option($optionName, '');
        if (is_string($existing) && $this->optionLockExpired($existing)
            && $this->deleteOptionLockValue($optionName, $existing)
            && add_option($optionName, $value, '', false)) {
            $this->ownedOptionLocks[$optionName] = $value;

            return true;
        }

        return false;
    }

    private function releaseOptionLock(string $optionName): void
    {
        $owned = $this->ownedOptionLocks[$optionName] ?? null;
        if (!is_string($owned)) {
            return;
        }
        $this->deleteOptionLockValue($optionName, $owned);
        unset($this->ownedOptionLocks[$optionName]);
    }

    private static function lockToken(): string
    {
        try {
            return bin2hex(random_bytes(16));
        } catch (\Throwable $exception) {
            return hash('sha256', uniqid('kodety-rocket-', true) . '|' . microtime(true));
        }
    }

    private function optionLockExpired(string $value): bool
    {
        $separator = strrpos($value, '|');
        if ($separator === false) {
            return false;
        }
        $expires = filter_var(substr($value, $separator + 1), FILTER_VALIDATE_INT);

        return $expires !== false && $expires <= time();
    }

    /** Deletes only the exact lock value observed by this worker. */
    private function deleteOptionLockValue(string $optionName, string $expected): bool
    {
        global $wpdb;

        if (isset($wpdb) && is_object($wpdb)
            && isset($wpdb->options)
            && is_string($wpdb->options)
            && method_exists($wpdb, 'prepare')
            && method_exists($wpdb, 'query')) {
            $table = preg_replace('/[^A-Za-z0-9_$]/', '', $wpdb->options);
            if (is_string($table) && $table !== '') {
                $sql = $wpdb->prepare(
                    "DELETE FROM {$table} WHERE option_name = %s AND option_value = %s",
                    $optionName,
                    $expected
                );
                $deleted = is_string($sql) ? $wpdb->query($sql) : false;
                if ($deleted === 1) {
                    if (function_exists('wp_cache_delete')) {
                        wp_cache_delete($optionName, 'options');
                    }

                    return true;
                }

                return false;
            }
        }

        // Isolated-test fallback. Production WordPress always supplies $wpdb;
        // recheck the token immediately before the non-conditional delete.
        if (!function_exists('get_option') || !function_exists('delete_option')) {
            return false;
        }
        $current = get_option($optionName, '');

        return is_string($current)
            && hash_equals($expected, $current)
            && delete_option($optionName);
    }

    /** @param mixed $response */
    private function responseLocation($response): string
    {
        if (function_exists('wp_remote_retrieve_header')) {
            $location = wp_remote_retrieve_header($response, 'location');

            return is_scalar($location) ? trim((string) $location) : '';
        }
        if (is_array($response)) {
            $headers = $response['headers'] ?? [];
            if (is_array($headers) && isset($headers['location']) && is_scalar($headers['location'])) {
                return trim((string) $headers['location']);
            }
        }

        return '';
    }

    private function redirectUrl(string $currentUrl, string $location): ?string
    {
        if ($location === '' || preg_match('/[\x00-\x1F\x7F]/', $location) === 1) {
            return null;
        }
        if (filter_var($location, FILTER_VALIDATE_URL)) {
            return $this->withoutFragment($location);
        }

        $current = parse_url($currentUrl);
        if (!is_array($current) || !isset($current['scheme'], $current['host'])) {
            return null;
        }
        if (str_starts_with($location, '//')) {
            $candidate = (string) $current['scheme'] . ':' . $location;

            return filter_var($candidate, FILTER_VALIDATE_URL) ? $this->withoutFragment($candidate) : null;
        }
        if (!str_starts_with($location, '/')) {
            return null;
        }

        $authority = (string) $current['host'];
        if (str_contains($authority, ':') && $authority[0] !== '[') {
            $authority = '[' . $authority . ']';
        }
        if (isset($current['port'])) {
            $authority .= ':' . (int) $current['port'];
        }
        $candidate = (string) $current['scheme'] . '://' . $authority . $location;

        return filter_var($candidate, FILTER_VALIDATE_URL) ? $this->withoutFragment($candidate) : null;
    }

    /** @return array<string, mixed> */
    private function rawState(): array
    {
        $state = function_exists('get_option') ? get_option(self::STATE_OPTION, []) : [];

        return is_array($state) ? $state : [];
    }

    /** @param array<string, mixed> $state */
    private function saveState(array $state): bool
    {
        if (!function_exists('update_option')) {
            return false;
        }

        $updated = update_option(self::STATE_OPTION, $state, false);

        return $updated !== false || $this->rawState() === $state;
    }
}
