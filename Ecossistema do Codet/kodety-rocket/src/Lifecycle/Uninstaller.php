<?php

declare(strict_types=1);

namespace KodetyRocket\Lifecycle;

use KodetyRocket\Cache\CacheInvalidator;
use KodetyRocket\Cache\FileCacheStore;
use KodetyRocket\Cache\GarbageCollector;
use KodetyRocket\Diagnostics\Logger;
use KodetyRocket\Optimization\AssetCacheMaintenance;
use KodetyRocket\Preload\Preloader;
use KodetyRocket\Settings\SettingsRepository;

final class Uninstaller
{
    private static bool $removeUserPreferences = false;

    public static function uninstall(): void
    {
        $networkIds = [];
        if (function_exists('is_multisite') && is_multisite() && function_exists('get_sites')) {
            $networkIds = self::networkIds();
            foreach ($networkIds as $networkId) {
                $offset = 0;
                do {
                    $siteIds = get_sites([
                        'network_id' => $networkId,
                        'fields' => 'ids',
                        'number' => 100,
                        'offset' => $offset,
                    ]);
                    foreach (is_array($siteIds) ? $siteIds : [] as $siteId) {
                        switch_to_blog((int) $siteId);
                        try {
                            self::cleanCurrentSite();
                        } finally {
                            restore_current_blog();
                        }
                    }
                    $count = is_array($siteIds) ? count($siteIds) : 0;
                    $offset += $count;
                } while ($count === 100);
            }
        } else {
            self::cleanCurrentSite();
        }

        if ($networkIds !== [] && function_exists('delete_network_option')) {
            foreach ($networkIds as $networkId) {
                delete_network_option($networkId, CacheInvalidator::NETWORK_GENERATION_OPTION);
                delete_network_option($networkId, CacheInvalidator::NETWORK_PENDING_OPTION);
                self::deleteExpiredNetworkLock($networkId);
            }
        } elseif (function_exists('delete_site_option')) {
            delete_site_option(CacheInvalidator::NETWORK_GENERATION_OPTION);
            delete_site_option(CacheInvalidator::NETWORK_PENDING_OPTION);
        }
        if (function_exists('wp_clear_scheduled_hook')) {
            wp_clear_scheduled_hook(CacheInvalidator::RETRY_NETWORK_HOOK);
        }
        if (self::$removeUserPreferences && function_exists('delete_metadata')) {
            delete_metadata('user', 0, 'kodety_rocket_locale', '', true);
            delete_metadata('user', 0, 'kodety_rocket_theme', '', true);
        }
    }

    /** @return list<int> */
    private static function networkIds(): array
    {
        if (function_exists('get_networks')) {
            $ids = get_networks(['fields' => 'ids', 'number' => 0]);
            if (is_array($ids)) {
                $ids = array_values(array_unique(array_filter(array_map('intval', $ids), static fn (int $id): bool => $id > 0)));
                if ($ids !== []) {
                    return $ids;
                }
            }
        }

        return [function_exists('get_current_network_id') ? max(1, (int) get_current_network_id()) : 1];
    }

    private static function deleteExpiredNetworkLock(int $networkId): void
    {
        if (!function_exists('get_network_option') || !function_exists('delete_network_option')) {
            return;
        }
        $value = get_network_option($networkId, CacheInvalidator::NETWORK_RETRY_LOCK_OPTION, '');
        if (!is_string($value)) {
            return;
        }
        $separator = strrpos($value, '|');
        $expires = $separator === false
            ? false
            : filter_var(substr($value, $separator + 1), FILTER_VALIDATE_INT);
        if ($expires !== false && $expires <= time()) {
            self::deleteNetworkOptionIfMatches(
                $networkId,
                CacheInvalidator::NETWORK_RETRY_LOCK_OPTION,
                $value
            );
        }
    }

    /** Deletes an expired lock only if its exact owner token is still stored. */
    private static function deleteNetworkOptionIfMatches(
        int $networkId,
        string $optionName,
        string $expected
    ): bool {
        global $wpdb;

        if (!isset($wpdb) || !is_object($wpdb)
            || !method_exists($wpdb, 'prepare')
            || !method_exists($wpdb, 'query')) {
            // WordPress production always exposes $wpdb. Leaving an expired
            // lock is safer than a non-atomic read/delete fallback.
            return false;
        }

        $multisite = function_exists('is_multisite') && is_multisite();
        $tableProperty = $multisite ? 'sitemeta' : 'options';
        if (!isset($wpdb->{$tableProperty}) || !is_string($wpdb->{$tableProperty})) {
            return false;
        }
        $table = preg_replace('/[^A-Za-z0-9_$]/', '', $wpdb->{$tableProperty});
        if (!is_string($table) || $table === '') {
            return false;
        }

        if ($multisite) {
            $sql = $wpdb->prepare(
                "DELETE FROM {$table} WHERE site_id = %d AND meta_key = %s AND meta_value = %s",
                $networkId,
                $optionName,
                $expected
            );
        } else {
            $sql = $wpdb->prepare(
                "DELETE FROM {$table} WHERE option_name = %s AND option_value = %s",
                $optionName,
                $expected
            );
        }
        $deleted = is_string($sql) ? $wpdb->query($sql) : false;
        if ($deleted !== 1) {
            return false;
        }

        if (function_exists('wp_cache_delete')) {
            if ($multisite) {
                wp_cache_delete($networkId . ':' . $optionName, 'site-options');
            } else {
                wp_cache_delete($optionName, 'options');
            }
        }

        return true;
    }

    private static function cleanCurrentSite(): void
    {
        $storedSettings = function_exists('get_option') ? get_option(SettingsRepository::OPTION_NAME, []) : [];
        $removePersistentData = is_array($storedSettings) && !empty($storedSettings['remove_data_on_uninstall']);
        self::$removeUserPreferences = self::$removeUserPreferences || $removePersistentData;

        // Rotate the generation before removing state so an already-running
        // worker cannot resume or enqueue another batch after uninstall.
        Preloader::cancelStoredWork();
        if (function_exists('wp_clear_scheduled_hook')) {
            wp_clear_scheduled_hook(CacheInvalidator::RETRY_SITE_HOOK);
            wp_clear_scheduled_hook(CacheInvalidator::RETRY_NETWORK_HOOK);
        }
        GarbageCollector::unschedule();
        if (function_exists('delete_option')) {
            delete_option(Preloader::STATE_OPTION);
            delete_option(Preloader::PENDING_OPTION);
            delete_option(Preloader::GENERATION_OPTION);
            if ($removePersistentData) {
                delete_option(SettingsRepository::OPTION_NAME);
                delete_option(SettingsRepository::BACKUP_OPTION_NAME);
            }
        }
        if (function_exists('delete_transient')) {
            delete_transient('kodety_rocket_preload_lock');
        }

        Capabilities::revoke();
        (new Logger())->purgeStorage();
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
            // Uninstall should complete even if cache files are owned by the web server.
            if (function_exists('update_option')) {
                update_option(CacheInvalidator::PENDING_OPTION, time(), false);
            }
        }
        if (function_exists('delete_option')) {
            delete_option(CacheInvalidator::SITE_GENERATION_OPTION);
        }
    }
}
