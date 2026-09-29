<?php

declare(strict_types=1);

namespace KodetyRocket;

use KodetyRocket\Admin\AdminPage;
use KodetyRocket\Cache\CacheInvalidator;
use KodetyRocket\Cache\FileCacheStore;
use KodetyRocket\Cache\GarbageCollector;
use KodetyRocket\Diagnostics\Logger;
use KodetyRocket\Http\PageCacheController;
use KodetyRocket\Http\RequestGate;
use KodetyRocket\Http\ResponseGate;
use KodetyRocket\Lifecycle\Activator;
use KodetyRocket\Lifecycle\Capabilities;
use KodetyRocket\Optimization\DeferScripts;
use KodetyRocket\Optimization\LazyLoadTransformer;
use KodetyRocket\Optimization\LocalAssetMinifier;
use KodetyRocket\Optimization\Pipeline;
use KodetyRocket\Preload\Preloader;
use KodetyRocket\Settings\SettingsRepository;

/** Composition root for the standalone Kodety Rocket plugin. */
final class Plugin
{
    private static ?self $instance = null;

    private SettingsRepository $settings;
    private Logger $logger;
    private FileCacheStore $cache;
    private CacheInvalidator $invalidator;
    private Preloader $preloader;

    public static function boot(): void
    {
        if (self::$instance !== null) {
            return;
        }

        $plugin = new self();
        $plugin->register();
        self::$instance = $plugin;
    }

    private function __construct()
    {
        $this->settings = new SettingsRepository();
        $this->logger = new Logger($this->settings);
        $this->cache = new FileCacheStore(
            $this->logger,
            null,
            250,
            16777216,
            (bool) $this->settings->get('gzip_enabled', true),
            6
        );
        $this->invalidator = new CacheInvalidator(
            $this->cache,
            (array) $this->settings->get('ignored_query_parameters', []),
            (array) $this->settings->get('query_allowlist', []),
            $this->logger,
            true
        );
        $this->preloader = new Preloader($this->settings, $this->cache, $this->logger);
    }

    private function register(): void
    {
        if (function_exists('add_action')) {
            add_action('admin_init', [$this->settings, 'register']);
            add_action('init', [$this, 'loadTranslations'], 1);
            add_action('wp_initialize_site', [$this, 'onSiteCreated'], 20, 1);
            add_action('update_option_' . SettingsRepository::OPTION_NAME, [$this, 'onSettingsUpdated'], 20, 3);
            add_action('save_post', [$this, 'queueChangedPost'], 100, 3);
        }

        if (function_exists('add_filter')) {
            add_filter('option_page_capability_kodety_rocket', static fn (): string => Capabilities::MANAGE);
        }

        $pipeline = new Pipeline($this->logger);
        $pipeline->add(new LazyLoadTransformer($this->settings, $this->logger), 20);

        $requestGate = new RequestGate($this->settings);
        $responseGate = new ResponseGate($this->settings);
        (new PageCacheController(
            $this->settings,
            $this->cache,
            $requestGate,
            $responseGate,
            $pipeline,
            $this->logger
        ))->register();

        (new LocalAssetMinifier($this->settings, $this->logger, $requestGate))->register();
        (new DeferScripts($this->settings, $requestGate))->register();
        $this->invalidator->registerHooks();
        $this->preloader->register();
        (new GarbageCollector($this->cache, $this->logger))->register();

        if (class_exists(AdminPage::class)) {
            (new AdminPage(
                $this->settings,
                $this->cache,
                $this->logger,
                $this->preloader,
                $this->invalidator
            ))->register();
        }
    }

    public function loadTranslations(): void
    {
        if (function_exists('load_plugin_textdomain') && function_exists('plugin_basename') && defined('KODETY_ROCKET_FILE')) {
            load_plugin_textdomain(
                'kodety-rocket',
                false,
                dirname(plugin_basename((string) KODETY_ROCKET_FILE)) . '/languages'
            );
        }
    }

    /** @param mixed $site */
    public function onSiteCreated($site): void
    {
        if (!is_object($site) || !isset($site->blog_id) || !(function_exists('is_multisite') && is_multisite())) {
            return;
        }

        if (!function_exists('is_plugin_active_for_network') && defined('ABSPATH')) {
            $pluginFunctions = rtrim((string) ABSPATH, '/\\') . '/wp-admin/includes/plugin.php';
            if (is_file($pluginFunctions)) {
                require_once $pluginFunctions;
            }
        }

        if (function_exists('is_plugin_active_for_network')
            && defined('KODETY_ROCKET_FILE')
            && function_exists('plugin_basename')
            && is_plugin_active_for_network(plugin_basename((string) KODETY_ROCKET_FILE))) {
            Activator::activateSite((int) $site->blog_id);
        }
    }

    /** @param mixed $oldValue
     *  @param mixed $newValue
     *  @param mixed $option
     */
    public function onSettingsUpdated($oldValue, $newValue, $option = null): void
    {
        if ($oldValue === $newValue) {
            return;
        }

        $this->invalidator->purgeSite();
        $enabled = is_array($newValue) && !empty($newValue['preload_enabled']);
        if ($enabled) {
            $this->preloader->schedule();
        } else {
            $this->preloader->unschedule();
        }
    }

    /** @param mixed $postId
     *  @param mixed $post
     *  @param mixed $update
     */
    public function queueChangedPost($postId, $post = null, $update = null): void
    {
        if (!(bool) $this->settings->get('preload_enabled', false)
            || (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE)
            || (function_exists('wp_is_post_revision') && wp_is_post_revision((int) $postId))) {
            return;
        }

        $urls = [];
        if (function_exists('home_url')) {
            $urls[] = (string) home_url('/');
        }
        if (function_exists('get_permalink')) {
            $permalink = get_permalink((int) $postId);
            if (is_string($permalink)) {
                $urls[] = $permalink;
            }
        }
        $this->preloader->enqueue($urls);
    }
}
