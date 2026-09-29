<?php

declare(strict_types=1);

namespace KodetyRocket\Lifecycle;

use KodetyRocket\Cache\CacheInvalidator;
use KodetyRocket\Settings\SettingsRepository;

final class Activator
{
    public static function activate(bool $networkWide = false): void
    {
        if ($networkWide && function_exists('is_multisite') && is_multisite()) {
            self::forEverySite([self::class, 'activateCurrentSite']);
            return;
        }

        self::activateCurrentSite();
    }

    public static function activateSite(int $blogId): void
    {
        if (!function_exists('switch_to_blog') || !function_exists('restore_current_blog')) {
            self::activateCurrentSite();
            return;
        }

        switch_to_blog($blogId);
        try {
            self::activateCurrentSite();
        } finally {
            restore_current_blog();
        }
    }

    public static function activateCurrentSite(): void
    {
        $settings = new SettingsRepository();
        if (function_exists('add_option')) {
            add_option(SettingsRepository::OPTION_NAME, $settings->defaults(), '', false);
        }
        // Every activation starts a fresh logical cache generation. This also
        // makes orphaned files from a failed uninstall permanently ineligible.
        CacheInvalidator::rotateSiteGeneration();
        Capabilities::grant();
    }

    /** @param callable(): void $callback */
    private static function forEverySite(callable $callback): void
    {
        if (!function_exists('get_sites') || !function_exists('switch_to_blog') || !function_exists('restore_current_blog')) {
            $callback();
            return;
        }

        // Network activation is scoped to the network from which WordPress
        // invoked the hook. Omitting network_id makes WP_Site_Query span every
        // network in a multi-network installation. If the network context is
        // unavailable, activate only the current site rather than mutating an
        // unknown set of sites.
        if (!function_exists('get_current_network_id')) {
            $callback();
            return;
        }
        $networkId = max(1, (int) get_current_network_id());

        $offset = 0;
        do {
            $siteIds = get_sites([
                'fields' => 'ids',
                'number' => 100,
                'offset' => $offset,
                'network_id' => $networkId,
                'orderby' => 'id',
                'order' => 'ASC',
            ]);
            if (!is_array($siteIds)) {
                break;
            }
            foreach ($siteIds as $siteId) {
                switch_to_blog((int) $siteId);
                try {
                    $callback();
                } finally {
                    restore_current_blog();
                }
            }
            $offset += count($siteIds);
        } while (count($siteIds) === 100);
    }
}
