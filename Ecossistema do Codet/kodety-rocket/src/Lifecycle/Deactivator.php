<?php

declare(strict_types=1);

namespace KodetyRocket\Lifecycle;

use KodetyRocket\Cache\CacheInvalidator;
use KodetyRocket\Cache\FileCacheStore;
use KodetyRocket\Cache\GarbageCollector;
use KodetyRocket\Optimization\AssetCacheMaintenance;
use KodetyRocket\Preload\Preloader;

final class Deactivator
{
    public static function deactivate(bool $networkWide = false): void
    {
        if ($networkWide && function_exists('is_multisite') && is_multisite() && function_exists('get_sites')) {
            $offset = 0;
            $networkId = function_exists('get_current_network_id') ? max(1, (int) get_current_network_id()) : null;
            do {
                $query = ['fields' => 'ids', 'number' => 100, 'offset' => $offset];
                if ($networkId !== null) {
                    $query['network_id'] = $networkId;
                }
                $siteIds = get_sites($query);
                foreach (is_array($siteIds) ? $siteIds : [] as $siteId) {
                    switch_to_blog((int) $siteId);
                    try {
                        self::deactivateCurrentSite();
                    } finally {
                        restore_current_blog();
                    }
                }
                $count = is_array($siteIds) ? count($siteIds) : 0;
                $offset += $count;
            } while ($count === 100);
            if (function_exists('wp_clear_scheduled_hook')) {
                wp_clear_scheduled_hook(CacheInvalidator::RETRY_NETWORK_HOOK);
            }
            if (function_exists('delete_site_option')) {
                delete_site_option(CacheInvalidator::NETWORK_PENDING_OPTION);
            }
            return;
        }

        self::deactivateCurrentSite();
    }

    private static function deactivateCurrentSite(): void
    {
        Preloader::cancelStoredWork();
        if (function_exists('wp_clear_scheduled_hook')) {
            wp_clear_scheduled_hook(CacheInvalidator::RETRY_SITE_HOOK);
            // WP-Cron is site-scoped, including this network retry hook.
            wp_clear_scheduled_hook(CacheInvalidator::RETRY_NETWORK_HOOK);
        }
        GarbageCollector::unschedule();

        try {
            $blogId = function_exists('get_current_blog_id') ? max(1, (int) get_current_blog_id()) : 1;
            $generationRotated = CacheInvalidator::rotateSiteGeneration($blogId);
            if (!$generationRotated && function_exists('update_option')) {
                update_option(CacheInvalidator::PENDING_OPTION, time(), false);
            }
            $store = new FileCacheStore();
            $store->purgeAll($blogId);
            if ($generationRotated && $store->lastPurgeSucceeded()) {
                if (function_exists('delete_option')) {
                    delete_option(CacheInvalidator::PENDING_OPTION);
                }
            } elseif (function_exists('update_option')) {
                update_option(CacheInvalidator::PENDING_OPTION, time(), false);
            }
            AssetCacheMaintenance::purge($blogId);
        } catch (\Throwable $exception) {
            // Deactivation must remain reversible even on a read-only filesystem.
            if (function_exists('update_option')) {
                update_option(CacheInvalidator::PENDING_OPTION, time(), false);
            }
        }
    }
}
