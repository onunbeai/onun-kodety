<?php

declare(strict_types=1);

namespace KodetyRocket\Cache;

use KodetyRocket\Diagnostics\Logger;
use KodetyRocket\Optimization\AssetCacheMaintenance;

/** Removes expired page-cache entries in a bounded background lifecycle. */
final class GarbageCollector
{
    public const HOOK = 'kodety_rocket_cache_gc';

    private FileCacheStore $store;
    private Logger $logger;

    public function __construct(FileCacheStore $store, Logger $logger)
    {
        $this->store = $store;
        $this->logger = $logger;
    }

    public function register(): void
    {
        if (!function_exists('add_action')) {
            return;
        }

        add_action(self::HOOK, [$this, 'run']);
        add_action('init', [$this, 'ensureScheduled'], 40);
    }

    public function ensureScheduled(): void
    {
        if (!function_exists('wp_next_scheduled')
            || !function_exists('wp_schedule_event')
            || wp_next_scheduled(self::HOOK)) {
            return;
        }

        $result = wp_schedule_event(time() + 5 * 60, 'daily', self::HOOK, [], true);
        if (($result === false || (function_exists('is_wp_error') && is_wp_error($result)))) {
            $this->logger->warning('Cache garbage collection could not be scheduled.');
        }
    }

    public function run(): void
    {
        try {
            $blogId = function_exists('get_current_blog_id') ? max(1, (int) get_current_blog_id()) : 1;
            $this->store->pruneExpired($blogId);
            AssetCacheMaintenance::prune($blogId);
        } catch (\Throwable $exception) {
            $this->logger->warning('Cache garbage collection failed open.', ['exception' => $exception]);
        }
    }

    public static function unschedule(): void
    {
        if (function_exists('wp_clear_scheduled_hook')) {
            wp_clear_scheduled_hook(self::HOOK);
        }
    }
}
