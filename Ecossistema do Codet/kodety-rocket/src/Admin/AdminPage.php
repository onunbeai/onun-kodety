<?php

declare(strict_types=1);

namespace KodetyRocket\Admin;

use KodetyRocket\Cache\CacheInvalidator;
use KodetyRocket\Cache\FileCacheStore;
use KodetyRocket\Diagnostics\Logger;
use KodetyRocket\Preload\Preloader;
use KodetyRocket\Settings\SettingsRepository;
use KodetyRocket\Support\Icons;
use KodetyRocket\Support\Translator;

/** Owns the isolated Kodety Rocket WordPress admin application. */
final class AdminPage
{
    private const MENU_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMTQgMTIyIj48cGF0aCBmaWxsPSIjODg4OEY4IiBkPSJNNTEuMTkzMiAxMjJMMCA2MUwxMTMuMTgzIDk0LjgyODlWMTIySDUxLjE5MzJaIi8+PHBhdGggZmlsbD0iIzg4ODhGOCIgZD0iTTUxLjE5MzIgMEwwIDYxTDExMy4xODMgMjcuMTcxMVYwSDUxLjE5MzJaIi8+PC9zdmc+';
    private const CAPABILITY = 'manage_kodety_rocket';
    private const PAGE_SLUG = 'kodety-rocket';
    private const LOCALE_META_KEY = 'kodety_rocket_locale';
    private const THEME_META_KEY = 'kodety_rocket_theme';

    private SettingsRepository $settings;
    private FileCacheStore $cache;
    private Logger $logger;
    private Preloader $preloader;
    private CacheInvalidator $invalidator;
    private string $hookSuffix = '';

    public function __construct(
        SettingsRepository $settings,
        FileCacheStore $cache,
        Logger $logger,
        Preloader $preloader,
        ?CacheInvalidator $invalidator = null
    ) {
        $this->settings = $settings;
        $this->cache = $cache;
        $this->logger = $logger;
        $this->preloader = $preloader;
        $this->invalidator = $invalidator ?? new CacheInvalidator(
            $cache,
            (array) $settings->get('ignored_query_parameters', []),
            (array) $settings->get('query_allowlist', []),
            $logger,
            true
        );
    }

    public function register(): void
    {
        add_action('admin_menu', [$this, 'registerMenu']);
        add_action('admin_enqueue_scripts', [$this, 'enqueueAssets']);
        add_action('admin_post_kodety_rocket_save', [$this, 'handleSave']);
        add_action('admin_post_kodety_rocket_purge', [$this, 'handlePurge']);
        add_action('admin_post_kodety_rocket_rollback', [$this, 'handleRollback']);
        add_action('admin_post_kodety_rocket_preload', [$this, 'handlePreload']);
        add_action('admin_post_kodety_rocket_preferences', [$this, 'handlePreferences']);
    }

    public function registerMenu(): void
    {
        $this->hookSuffix = (string) add_menu_page(
            'Kodety Rocket',
            'Kodety Rocket',
            self::CAPABILITY,
            self::PAGE_SLUG,
            [$this, 'render'],
            self::MENU_ICON,
            59
        );
    }

    public function enqueueAssets(string $hookSuffix): void
    {
        if ($hookSuffix !== $this->hookSuffix) {
            return;
        }

        $baseUrl = defined('KODETY_ROCKET_URL')
            ? (string) KODETY_ROCKET_URL
            : plugin_dir_url(dirname(__DIR__, 2) . '/kodety-rocket.php');
        $version = defined('KODETY_ROCKET_VERSION') ? (string) KODETY_ROCKET_VERSION : '1.0.0';
        $styleUrl = rtrim($baseUrl, '/') . '/assets/admin.css';

        wp_enqueue_style(
            'kodety-rocket-admin',
            $styleUrl,
            [],
            $version
        );
        wp_enqueue_script(
            'kodety-rocket-admin',
            rtrim($baseUrl, '/') . '/assets/admin.js',
            [],
            $version,
            true
        );
        wp_localize_script(
            'kodety-rocket-admin',
            'KodetyRocketAdmin',
            [
                'locale' => $this->currentLocale(),
                'theme' => $this->currentTheme(),
                'catalogues' => Translator::catalogues(),
                'defaultLocale' => Translator::DEFAULT_LOCALE,
                'styleUrl' => $styleUrl,
                'storageKeys' => [
                    'theme' => 'kodetyRocketTheme',
                    'locale' => 'kodetyRocketLocale',
                    'section' => 'kodetyRocketSection',
                ],
            ]
        );
    }

    public function handleSave(): void
    {
        $this->authorize('kodety_rocket_save');

        $posted = isset($_POST['settings']) && is_array($_POST['settings'])
            ? wp_unslash($_POST['settings'])
            : [];
        $changes = $this->sanitizeChanges($posted);

        try {
            $result = $this->settings->update($changes);
            if ($this->isError($result)) {
                $this->redirect('error', 'cache');
            }

            $this->record('info', 'settings_updated', ['keys' => array_keys($changes)]);
            $this->redirect('saved', $this->postedSection());
        } catch (\Throwable $exception) {
            $this->record('error', 'settings_update_failed', ['exception' => get_class($exception)]);
            $this->redirect('error', $this->postedSection());
        }
    }

    public function handlePurge(): void
    {
        $this->authorize('kodety_rocket_purge');

        try {
            $result = $this->purgeCache();
            if ($this->isError($result) || $result === false) {
                $this->redirect('error', 'overview');
            }

            $this->record('info', 'cache_purged', ['source' => 'admin']);
            $this->redirect('purged', 'overview');
        } catch (\Throwable $exception) {
            $this->record('error', 'cache_purge_failed', ['exception' => get_class($exception)]);
            $this->redirect('error', 'overview');
        }
    }

    public function handleRollback(): void
    {
        $this->authorize('kodety_rocket_rollback');

        try {
            $result = $this->settings->rollback();
            if ($this->isError($result)) {
                $this->redirect('error', 'advanced');
            }

            $purge = $this->purgeCache();
            if ($this->isError($purge) || $purge === false) {
                $this->redirect('error', 'advanced');
            }

            $this->record('warning', 'settings_rolled_back', ['source' => 'admin']);
            $this->redirect('rolled_back', 'advanced');
        } catch (\Throwable $exception) {
            $this->record('error', 'settings_rollback_failed', ['exception' => get_class($exception)]);
            $this->redirect('error', 'advanced');
        }
    }

    public function handlePreload(): void
    {
        $this->authorize('kodety_rocket_preload');

        try {
            // The dashboard action is an explicit one-off warmup and remains
            // available when automatic preload is disabled.
            $result = $this->preloader->schedule([], true);
            if ($this->isError($result) || $result === false) {
                $this->redirect('error', 'overview');
            }

            $this->record('info', 'preload_scheduled', ['source' => 'admin']);
            $this->redirect('preload_scheduled', 'overview');
        } catch (\Throwable $exception) {
            $this->record('error', 'preload_schedule_failed', ['exception' => get_class($exception)]);
            $this->redirect('error', 'overview');
        }
    }

    public function handlePreferences(): void
    {
        $this->authorize('kodety_rocket_preferences');

        $locale = Translator::normalize(
            isset($_POST['locale']) && is_scalar($_POST['locale'])
                ? sanitize_text_field(wp_unslash((string) $_POST['locale']))
                : null
        );
        $theme = isset($_POST['theme']) && is_scalar($_POST['theme'])
            ? sanitize_key(wp_unslash((string) $_POST['theme']))
            : 'dark';
        if (!in_array($theme, ['dark', 'light'], true)) {
            $theme = 'dark';
        }

        update_user_meta(get_current_user_id(), self::LOCALE_META_KEY, $locale);
        update_user_meta(get_current_user_id(), self::THEME_META_KEY, $theme);

        if (isset($_POST['kodety_rocket_async']) && is_scalar($_POST['kodety_rocket_async']) && (string) $_POST['kodety_rocket_async'] === '1') {
            wp_send_json_success(['locale' => $locale, 'theme' => $theme]);
        }

        $this->redirect('preferences_saved', 'overview');
    }

    public function render(): void
    {
        if (!current_user_can(self::CAPABILITY)) {
            wp_die(esc_html__('You are not allowed to manage Kodety Rocket.', 'kodety-rocket'));
        }

        $settings = $this->currentSettings();
        $locale = $this->currentLocale();
        $theme = $this->currentTheme();
        $cacheStats = $this->cacheStats();
        $preload = $this->preloadStatus();
        $logs = $this->recentLogs();
        $activeModules = count(array_filter([
            (bool) ($settings['page_cache_enabled'] ?? false),
            (bool) ($settings['gzip_enabled'] ?? false),
            (bool) ($settings['minify_css_enabled'] ?? false),
            (bool) ($settings['minify_js_enabled'] ?? false),
            (bool) ($settings['defer_js_enabled'] ?? false),
            (bool) ($settings['lazy_load_enabled'] ?? false),
            (bool) ($settings['preload_enabled'] ?? false),
        ]));
        $preloadKey = $this->preloadTranslationKey($preload);
        $notice = isset($_GET['kodety_rocket_notice']) && is_scalar($_GET['kodety_rocket_notice'])
            ? sanitize_key(wp_unslash((string) $_GET['kodety_rocket_notice']))
            : '';
        $allowedNotices = ['saved', 'purged', 'rolled_back', 'preload_scheduled', 'preferences_saved', 'error'];
        if (!in_array($notice, $allowedNotices, true)) {
            $notice = '';
        }
        $baseUrl = defined('KODETY_ROCKET_URL')
            ? (string) KODETY_ROCKET_URL
            : plugin_dir_url(dirname(__DIR__, 2) . '/kodety-rocket.php');
        $styleUrl = rtrim($baseUrl, '/') . '/assets/admin.css';
        $t = static fn (string $key): string => Translator::get($key, $locale);
        $copy = static function (string $key) use ($t): void {
            printf('<span data-i18n="%s">%s</span>', esc_attr($key), esc_html($t($key)));
        };
        ?>
        <div class="kodety-rocket-host" data-kodety-rocket-host data-kodety-rocket-style="<?php echo esc_url($styleUrl); ?>">
        <div class="kodety-rocket-root" data-kodety-rocket data-theme="<?php echo esc_attr($theme); ?>" data-locale="<?php echo esc_attr($locale); ?>">
            <?php echo Icons::sprite(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>

            <header class="kr-topbar">
                <div class="kr-brand">
                    <span class="kr-brand__official">
                        <svg viewBox="0 0 209 43" role="img" aria-label="Kodety" focusable="false" xmlns="http://www.w3.org/2000/svg">
                            <path class="kr-kodety-symbol" d="M16.8662 38.9809L0 19.4905L37.2894 30.2993V38.9809H16.8662Z"/>
                            <path class="kr-kodety-symbol" d="M16.8662 0L0 19.4905L37.2894 8.68159V0H16.8662Z"/>
                            <path d="M64.7109 24.4918L63.4254 20.8477L76.1813 8.66867H81.6199L64.7109 24.4918ZM60.805 32.4513V2.07186H65.2548V32.4513H60.805ZM77.3679 32.4513L67.2324 19.7928L70.0506 16.9638L83.0042 32.4513H77.3679Z"/>
                            <path d="M95.5027 33.0266C93.0966 33.0266 90.9377 32.5152 89.0259 31.4923C87.1142 30.4374 85.6145 28.983 84.5268 27.129C83.4391 25.243 82.8952 23.0533 82.8952 20.56C82.8952 18.0347 83.4391 15.845 84.5268 13.991C85.6474 12.137 87.1636 10.6985 89.0754 9.67559C91.0201 8.62072 93.1955 8.09328 95.6016 8.09328C98.0078 8.09328 100.167 8.62072 102.078 9.67559C103.99 10.6985 105.49 12.137 106.578 13.991C107.665 15.845 108.209 18.0347 108.209 20.56C108.209 23.0533 107.649 25.243 106.528 27.129C105.44 28.983 103.941 30.4374 102.029 31.4923C100.117 32.5152 97.9419 33.0266 95.5027 33.0266ZM95.5027 29.3346C96.986 29.3346 98.3374 29.0149 99.5569 28.3756C100.809 27.7043 101.798 26.7134 102.523 25.4028C103.282 24.0922 103.661 22.4779 103.661 20.56C103.661 18.61 103.282 16.9958 102.523 15.7171C101.798 14.4065 100.826 13.4316 99.6064 12.7923C98.3868 12.121 97.0519 11.7853 95.6016 11.7853C94.1513 11.7853 92.7999 12.121 91.5474 12.7923C90.3279 13.4635 89.339 14.4385 88.5809 15.7171C87.8228 16.9958 87.4438 18.61 87.4438 20.56C87.4438 22.4779 87.8064 24.0922 88.5315 25.4028C89.2896 26.7134 90.2784 27.7043 91.498 28.3756C92.7175 29.0149 94.0525 29.3346 95.5027 29.3346Z"/>
                            <path d="M123.001 33.0266C120.562 33.0266 118.436 32.4832 116.623 31.3964C114.81 30.3096 113.393 28.8231 112.371 26.9372C111.349 25.0512 110.838 22.9095 110.838 20.512C110.838 18.1146 111.349 15.9888 112.371 14.1348C113.393 12.2488 114.81 10.7784 116.623 9.72354C118.469 8.6367 120.594 8.09328 123.001 8.09328C125.011 8.09328 126.775 8.49286 128.291 9.292C129.84 10.0592 131.027 11.146 131.851 12.5525V2.07186H136.3V32.4513H133.071L131.851 28.5674C131.06 29.7182 129.939 30.7571 128.489 31.6841C127.071 32.5791 125.242 33.0266 123.001 33.0266ZM123.594 29.2866C125.209 29.2866 126.626 28.919 127.846 28.1838C129.065 27.4486 130.021 26.4257 130.713 25.1151C131.406 23.8045 131.752 22.2861 131.752 20.56C131.752 18.8338 131.406 17.3154 130.713 16.0048C130.021 14.6942 129.065 13.6713 127.846 12.9361C126.626 12.2009 125.209 11.8333 123.594 11.8333C122.012 11.8333 120.594 12.2009 119.342 12.9361C118.089 13.6713 117.117 14.6942 116.425 16.0048C115.733 17.2835 115.387 18.8018 115.387 20.56C115.387 22.2861 115.733 23.8045 116.425 25.1151C117.117 26.4257 118.089 27.4486 119.342 28.1838C120.594 28.919 122.012 29.2866 123.594 29.2866Z"/>
                            <path d="M151.687 33.0266C149.314 33.0266 147.205 32.5152 145.359 31.4923C143.546 30.4374 142.112 28.983 141.057 27.129C140.036 25.2749 139.525 23.1013 139.525 20.6079C139.525 18.0826 140.036 15.893 141.057 14.0389C142.079 12.1529 143.513 10.6985 145.359 9.67559C147.205 8.62072 149.331 8.09328 151.737 8.09328C154.143 8.09328 156.203 8.62072 157.917 9.67559C159.664 10.6985 160.999 12.057 161.922 13.7512C162.878 15.4454 163.355 17.2994 163.355 19.3133C163.355 19.633 163.355 19.9846 163.355 20.3682C163.355 20.7198 163.339 21.1034 163.306 21.5189H142.837V18.3543H158.955C158.856 16.2765 158.115 14.6463 156.73 13.4635C155.379 12.2808 153.682 11.6894 151.638 11.6894C150.254 11.6894 148.968 11.9931 147.781 12.6005C146.595 13.1759 145.639 14.0549 144.914 15.2376C144.222 16.3884 143.876 17.8269 143.876 19.553V20.8477C143.876 22.7336 144.238 24.316 144.963 25.5946C145.688 26.8732 146.644 27.8322 147.831 28.4715C149.018 29.1108 150.287 29.4305 151.638 29.4305C153.286 29.4305 154.67 29.0629 155.791 28.3277C156.912 27.5925 157.736 26.5855 158.263 25.3069H162.663C162.235 26.7454 161.526 28.056 160.537 29.2387C159.548 30.4214 158.296 31.3484 156.78 32.0197C155.297 32.691 153.599 33.0266 151.687 33.0266Z"/>
                            <path d="M175.564 32.4513C174.179 32.4513 173.009 32.2914 172.053 31.9718C171.097 31.6202 170.372 30.9808 169.878 30.0538C169.416 29.1268 169.186 27.8162 169.186 26.122V12.3128H164.934V8.66867H169.186L170.101 2.86686H173.635V8.66867H180.557V12.3128H173.635V25.4507C173.635 26.4737 173.718 27.2248 173.883 27.7043C174.047 28.1838 174.394 28.4875 174.921 28.6154C175.448 28.7113 176.206 28.7592 177.195 28.7592H180.211V32.4513H175.564Z"/>
                            <path d="M183.389 43V39.4518H188.383C188.844 39.4518 189.223 39.3719 189.52 39.212C189.85 39.0842 190.163 38.7805 190.459 38.301C190.756 37.8215 191.119 37.1023 191.547 36.1433L194.316 30.2456L193.92 32.4992L183.192 8.66867H187.987L195.947 26.9372L204.353 8.66867H209L195.7 37.2941C195.107 38.5727 194.596 39.5956 194.168 40.3628C193.739 41.13 193.327 41.6894 192.932 42.041C192.569 42.4246 192.141 42.6803 191.646 42.8082C191.185 42.9361 190.575 43 189.817 43H183.389Z"/>
                        </svg>
                    </span>
                    <i class="kr-brand__divider" aria-hidden="true"></i>
                    <span class="kr-brand__copy">
                        <strong>Rocket</strong>
                        <?php $copy('brand.tagline'); ?>
                    </span>
                </div>
                <div class="kr-topbar__context">
                    <span class="kr-status"><i></i><span data-current-section-label data-i18n="nav.overview"><?php echo esc_html($t('nav.overview')); ?></span></span>
                    <span class="kr-free-chip"><?php $copy('brand.free'); ?></span>
                </div>
                <div class="kr-topbar__actions">
                    <form class="kr-preferences" id="kr-preferences-form" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post">
                        <input type="hidden" name="action" value="kodety_rocket_preferences">
                        <input type="hidden" name="theme" id="kr-theme-value" value="<?php echo esc_attr($theme); ?>">
                        <?php wp_nonce_field('kodety_rocket_preferences', 'kodety_rocket_preferences_nonce', false); ?>
                        <label class="kr-locale-control" for="kr-locale">
                            <?php echo Icons::icon('keyline-globe'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                            <span class="screen-reader-text"><?php $copy('top.language'); ?></span>
                            <select id="kr-locale" name="locale" aria-label="<?php echo esc_attr($t('top.language')); ?>" data-i18n-aria-label="top.language">
                                <?php foreach (Translator::locales() as $localeCode => $localeName) : ?>
                                    <option value="<?php echo esc_attr($localeCode); ?>" <?php selected($locale, $localeCode); ?>><?php echo esc_html($localeName); ?></option>
                                <?php endforeach; ?>
                            </select>
                        </label>
                        <button class="kr-icon-button kr-theme-toggle" type="button" data-theme-toggle aria-label="<?php echo esc_attr($theme === 'dark' ? $t('top.theme_light') : $t('top.theme_dark')); ?>" title="<?php echo esc_attr($theme === 'dark' ? $t('top.theme_light') : $t('top.theme_dark')); ?>">
                            <?php echo Icons::icon($theme === 'dark' ? 'keyline-sun' : 'keyline-moon', 'kr-theme-icon'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                        </button>
                        <button class="kr-button kr-button--quiet kr-preference-submit" type="submit"><?php $copy('common.apply'); ?></button>
                    </form>
                    <button class="kr-button kr-button--primary kr-top-save" type="submit" form="kr-settings-form">
                        <?php echo Icons::icon('keyline-save'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                        <?php $copy('top.save'); ?>
                    </button>
                </div>
            </header>

            <div class="kr-shell">
                <aside class="kr-sidebar">
                    <div class="kr-sidebar__heading">
                        <strong><?php $copy('nav.workspace'); ?></strong>
                        <small><?php $copy('nav.workspace_description'); ?></small>
                    </div>
                    <nav class="kr-nav" aria-label="<?php echo esc_attr($t('nav.label')); ?>" data-i18n-aria-label="nav.label">
                        <?php
                        $navigation = [
                            'overview' => 'solar-widget',
                            'cache' => 'solar-server',
                            'assets' => 'solar-code',
                            'delivery' => 'solar-speedometer',
                            'diagnostics' => 'solar-graph',
                            'advanced' => 'solar-settings',
                        ];
                        foreach ($navigation as $section => $navIcon) :
                            ?>
                            <a class="kr-nav__item<?php echo $section === 'overview' ? ' is-active' : ''; ?>" href="#kodety-rocket-<?php echo esc_attr($section); ?>" data-section="<?php echo esc_attr($section); ?>" aria-controls="kodety-rocket-<?php echo esc_attr($section); ?>" <?php echo $section === 'overview' ? 'aria-current="page"' : ''; ?>>
                                <span class="kr-nav__icon"><?php echo Icons::icon($navIcon); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                                <?php $copy('nav.' . $section); ?>
                                <?php echo Icons::icon('keyline-chevron-right', 'kr-nav__arrow'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                            </a>
                        <?php endforeach; ?>
                    </nav>

                    <div class="kr-sidebar__footer">
                        <div class="kr-included">
                            <?php echo Icons::icon('keyline-check'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                            <?php $copy('common.free'); ?>
                        </div>
                        <a class="kr-code-cta" href="https://code.com/" target="_blank" rel="noopener noreferrer">
                            <span class="kr-code-cta__mark"><?php echo Icons::icon('keyline-zap'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                            <span>
                                <strong><?php $copy('cta.meet_code'); ?></strong>
                                <small><?php $copy('cta.description'); ?></small>
                            </span>
                            <?php echo Icons::icon('keyline-arrow-up-right'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                        </a>
                    </div>
                </aside>

                <main class="kr-main">
                    <?php if ($notice !== '') : ?>
                        <div class="kr-notice <?php echo $notice === 'error' ? 'is-error' : 'is-success'; ?>" role="status" aria-live="polite">
                            <?php echo Icons::icon($notice === 'error' ? 'keyline-info' : 'keyline-check'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                            <?php $copy('notice.' . $notice); ?>
                        </div>
                    <?php endif; ?>

                    <form id="kr-settings-form" class="kr-settings-form" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post">
                        <input type="hidden" name="action" value="kodety_rocket_save">
                        <input type="hidden" name="section" value="overview" data-current-section>
                        <?php wp_nonce_field('kodety_rocket_save', 'kodety_rocket_save_nonce', false); ?>

                        <section class="kr-panel is-active" id="kodety-rocket-overview" data-panel="overview" aria-labelledby="kr-title-overview">
                            <div class="kr-hero">
                                <div class="kr-hero__copy">
                                    <p class="kr-eyebrow"><?php $copy('overview.eyebrow'); ?></p>
                                    <h1 id="kr-title-overview"><?php $copy('overview.title'); ?></h1>
                                    <p class="kr-lead"><?php $copy('overview.description'); ?></p>
                                </div>
                            </div>
                            <p class="kr-free-note"><?php echo Icons::icon('keyline-check'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?><?php $copy('overview.free_note'); ?></p>

                            <div class="kr-metrics">
                                <?php $this->renderMetric('keyline-database', $this->formatInteger($cacheStats['files']), 'overview.cache_files', 'overview.cache_hint', $locale); ?>
                                <?php $this->renderMetric('keyline-hard-drive', $this->formatBytes($cacheStats['bytes']), 'overview.cache_size', 'overview.size_hint', $locale); ?>
                                <?php $this->renderMetric('keyline-play', Translator::get($preloadKey, $locale), 'overview.preloader', 'overview.preload_hint', $locale, $preloadKey); ?>
                                <?php $this->renderMetric('keyline-zap', $activeModules . ' / 7', 'overview.active_modules', 'overview.modules_hint', $locale); ?>
                            </div>

                            <div class="kr-overview-grid">
                                <div class="kr-surface kr-foundation">
                                    <div class="kr-surface__header">
                                        <div>
                                            <h2><?php $copy('overview.foundation_title'); ?></h2>
                                            <p><?php $copy('overview.foundation_text'); ?></p>
                                        </div>
                                        <span class="kr-surface__header-icon"><?php echo Icons::icon('keyline-shield'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                                    </div>
                                    <div class="kr-foundation__grid">
                                        <?php $this->renderFoundation('keyline-shield', 'overview.foundation_gate', 'overview.foundation_gate_text', $locale); ?>
                                        <?php $this->renderFoundation('keyline-save', 'overview.foundation_atomic', 'overview.foundation_atomic_text', $locale); ?>
                                        <?php $this->renderFoundation('keyline-code', 'overview.foundation_keys', 'overview.foundation_keys_text', $locale); ?>
                                        <?php $this->renderFoundation('keyline-activity', 'overview.foundation_observe', 'overview.foundation_observe_text', $locale); ?>
                                    </div>
                                </div>

                                <div class="kr-surface kr-quick-actions">
                                    <div class="kr-surface__header">
                                        <div><h2><?php $copy('overview.quick_title'); ?></h2><p><?php $copy('overview.quick_text'); ?></p></div>
                                    </div>
                                    <div class="kr-action-stack">
                                        <button class="kr-action-button" type="submit" form="kr-purge-form" data-confirm="purge">
                                            <span><?php echo Icons::icon('keyline-trash'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                                            <?php $copy('action.purge'); ?>
                                            <?php echo Icons::icon('keyline-chevron-right'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                                        </button>
                                        <button class="kr-action-button" type="submit" form="kr-preload-form">
                                            <span><?php echo Icons::icon('keyline-play'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                                            <?php $copy('action.preload'); ?>
                                            <?php echo Icons::icon('keyline-chevron-right'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section class="kr-panel" id="kodety-rocket-cache" data-panel="cache" aria-labelledby="kr-title-cache">
                            <?php $this->renderPanelHeader('cache.eyebrow', 'cache.title', 'cache.description', 'solar-server', $locale, 'kr-title-cache'); ?>
                            <div class="kr-surface kr-settings-surface">
                                <?php $this->renderToggle('page_cache_enabled', 'cache.page_title', 'cache.page_help', 'keyline-database', (bool) $settings['page_cache_enabled'], $locale, 'common.recommended'); ?>
                                <?php $this->renderNumber('page_cache_ttl', 'cache.ttl_title', 'cache.ttl_help', 'keyline-clock', (int) $settings['page_cache_ttl'], 60, 604800, 60, 'cache.seconds', $locale); ?>
                                <?php $this->renderToggle('gzip_enabled', 'cache.gzip_title', 'cache.gzip_help', 'keyline-zap', (bool) $settings['gzip_enabled'], $locale); ?>
                                <?php $this->renderNumber('browser_cache_ttl', 'cache.browser_title', 'cache.browser_help', 'keyline-globe', (int) $settings['browser_cache_ttl'], 0, 86400, 60, 'cache.seconds', $locale); ?>
                                <?php $this->renderToggle('preload_enabled', 'cache.preload_title', 'cache.preload_help', 'keyline-play', (bool) $settings['preload_enabled'], $locale); ?>
                                <?php $this->renderNumber('preload_batch_size', 'cache.batch_title', 'cache.batch_help', 'keyline-refresh', (int) $settings['preload_batch_size'], 1, 25, 1, '', $locale); ?>
                            </div>
                        </section>

                        <section class="kr-panel" id="kodety-rocket-assets" data-panel="assets" aria-labelledby="kr-title-assets">
                            <?php $this->renderPanelHeader('assets.eyebrow', 'assets.title', 'assets.description', 'solar-code', $locale, 'kr-title-assets'); ?>
                            <div class="kr-surface kr-settings-surface">
                                <?php $this->renderToggle('minify_css_enabled', 'assets.css_title', 'assets.css_help', 'keyline-code', (bool) $settings['minify_css_enabled'], $locale); ?>
                                <?php $this->renderToggle('minify_js_enabled', 'assets.js_title', 'assets.js_help', 'keyline-zap', (bool) $settings['minify_js_enabled'], $locale); ?>
                                <?php $this->renderMegabytes('max_asset_mb', 'assets.limit_title', 'assets.limit_help', 'keyline-hard-drive', (int) $settings['max_asset_bytes'], 0.0625, 10, $locale); ?>
                            </div>
                            <div class="kr-callout">
                                <span class="kr-callout__icon"><?php echo Icons::icon('keyline-shield'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                                <div><strong><?php $copy('assets.safety_title'); ?></strong><p><?php $copy('assets.safety_text'); ?></p></div>
                            </div>
                        </section>

                        <section class="kr-panel" id="kodety-rocket-delivery" data-panel="delivery" aria-labelledby="kr-title-delivery">
                            <?php $this->renderPanelHeader('delivery.eyebrow', 'delivery.title', 'delivery.description', 'solar-speedometer', $locale, 'kr-title-delivery'); ?>
                            <div class="kr-surface kr-settings-surface">
                                <?php $this->renderToggle('defer_js_enabled', 'delivery.defer_title', 'delivery.defer_help', 'keyline-clock', (bool) $settings['defer_js_enabled'], $locale); ?>
                                <?php $this->renderToggle('lazy_load_enabled', 'delivery.lazy_title', 'delivery.lazy_help', 'keyline-image', (bool) $settings['lazy_load_enabled'], $locale); ?>
                            </div>
                            <div class="kr-callout">
                                <span class="kr-callout__icon"><?php echo Icons::icon('keyline-info'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                                <div><strong><?php $copy('delivery.note_title'); ?></strong><p><?php $copy('delivery.note_text'); ?></p></div>
                            </div>
                        </section>

                        <section class="kr-panel" id="kodety-rocket-diagnostics" data-panel="diagnostics" aria-labelledby="kr-title-diagnostics">
                            <?php $this->renderPanelHeader('diagnostics.eyebrow', 'diagnostics.title', 'diagnostics.description', 'solar-graph', $locale, 'kr-title-diagnostics'); ?>
                            <div class="kr-surface kr-settings-surface">
                                <?php $this->renderToggle('diagnostics_enabled', 'diagnostics.enable_title', 'diagnostics.enable_help', 'keyline-activity', (bool) $settings['diagnostics_enabled'], $locale); ?>
                                <?php $this->renderNumber('log_retention_days', 'diagnostics.retention_title', 'diagnostics.retention_help', 'keyline-clock', (int) $settings['log_retention_days'], 1, 30, 1, 'unit.days', $locale); ?>
                            </div>

                            <div class="kr-surface kr-log-surface">
                                <div class="kr-surface__header">
                                    <div><h2><?php $copy('diagnostics.recent_title'); ?></h2><p><?php $copy('diagnostics.recent_help'); ?></p></div>
                                    <span class="kr-count-badge"><?php echo esc_html((string) count($logs)); ?></span>
                                </div>
                                <div class="kr-log-table-wrap">
                                    <table class="kr-log-table">
                                        <thead><tr>
                                            <th><?php $copy('diagnostics.time'); ?></th>
                                            <th><?php $copy('diagnostics.level'); ?></th>
                                            <th><?php $copy('diagnostics.event'); ?></th>
                                            <th><?php $copy('diagnostics.context'); ?></th>
                                        </tr></thead>
                                        <tbody>
                                            <?php if ($logs === []) : ?>
                                                <tr><td colspan="4" class="kr-empty-state"><?php echo Icons::icon('keyline-activity'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?><?php $copy('diagnostics.empty'); ?></td></tr>
                                            <?php else : ?>
                                                <?php foreach ($logs as $record) : ?>
                                                    <?php
                                                    $level = isset($record['level']) ? sanitize_key((string) $record['level']) : 'info';
                                                    if (!in_array($level, ['info', 'warning', 'error'], true)) {
                                                        $level = 'info';
                                                    }
                                                    $event = isset($record['event']) ? (string) $record['event'] : (string) ($record['message'] ?? 'event');
                                                    $timestamp = isset($record['timestamp']) ? (string) $record['timestamp'] : (string) ($record['time'] ?? '');
                                                    $context = isset($record['context']) && is_array($record['context']) ? $record['context'] : [];
                                                    ?>
                                                    <tr>
                                                        <td><time datetime="<?php echo esc_attr($timestamp); ?>"><?php echo esc_html($this->formatTimestamp($timestamp)); ?></time></td>
                                                        <td><span class="kr-log-level is-<?php echo esc_attr($level); ?>"><?php echo esc_html($level); ?></span></td>
                                                        <td><code><?php echo esc_html($event); ?></code></td>
                                                        <td><code title="<?php echo esc_attr($this->formatContext($context, false)); ?>"><?php echo esc_html($this->formatContext($context, true)); ?></code></td>
                                                    </tr>
                                                <?php endforeach; ?>
                                            <?php endif; ?>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </section>

                        <section class="kr-panel" id="kodety-rocket-advanced" data-panel="advanced" aria-labelledby="kr-title-advanced">
                            <?php $this->renderPanelHeader('advanced.eyebrow', 'advanced.title', 'advanced.description', 'solar-settings', $locale, 'kr-title-advanced'); ?>
                            <div class="kr-surface kr-settings-surface">
                                <?php $this->renderMegabytes('max_response_mb', 'advanced.response_title', 'advanced.response_help', 'keyline-hard-drive', (int) $settings['max_response_bytes'], 0.25, 20, $locale); ?>
                                <?php $this->renderToggle('remove_data_on_uninstall', 'advanced.remove_data_title', 'advanced.remove_data_help', 'keyline-trash', (bool) ($settings['remove_data_on_uninstall'] ?? false), $locale); ?>
                            </div>
                            <div class="kr-surface kr-textarea-grid">
                                <?php $this->renderTextarea('excluded_paths', 'advanced.excluded_title', 'advanced.excluded_help', 'advanced.excluded_placeholder', (array) $settings['excluded_paths'], $locale); ?>
                                <?php $this->renderTextarea('query_allowlist', 'advanced.allowlist_title', 'advanced.allowlist_help', 'advanced.allowlist_placeholder', (array) $settings['query_allowlist'], $locale); ?>
                                <?php $this->renderTextarea('ignored_query_parameters', 'advanced.ignored_title', 'advanced.ignored_help', 'advanced.ignored_placeholder', (array) $settings['ignored_query_parameters'], $locale); ?>
                            </div>
                            <div class="kr-danger-zone">
                                <span class="kr-danger-zone__icon"><?php echo Icons::icon('keyline-history'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                                <div><strong><?php $copy('advanced.rollback_title'); ?></strong><p><?php $copy('advanced.rollback_text'); ?></p></div>
                                <button class="kr-button kr-button--danger" type="submit" form="kr-rollback-form" data-confirm="rollback">
                                    <?php echo Icons::icon('keyline-history'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                                    <?php $copy('action.rollback'); ?>
                                </button>
                            </div>
                        </section>

                        <div class="kr-savebar">
                            <div>
                                <strong><?php $copy('savebar.title'); ?></strong>
                                <span><?php $copy('savebar.text'); ?></span>
                            </div>
                            <button class="kr-button kr-button--primary" type="submit" data-save-button>
                                <?php echo Icons::icon('keyline-save'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                                <?php $copy('action.save'); ?>
                            </button>
                        </div>
                    </form>

                    <?php $this->renderActionForm('kr-purge-form', 'kodety_rocket_purge', 'kodety_rocket_purge'); ?>
                    <?php $this->renderActionForm('kr-preload-form', 'kodety_rocket_preload', 'kodety_rocket_preload'); ?>
                    <?php $this->renderActionForm('kr-rollback-form', 'kodety_rocket_rollback', 'kodety_rocket_rollback'); ?>
                </main>
            </div>
        </div>
        </div>
        <?php
    }

    /** @return array<string, mixed> */
    private function currentSettings(): array
    {
        $defaults = $this->settings->defaults();

        if (method_exists($this->settings, 'all')) {
            $stored = $this->settings->all();

            return is_array($stored) ? array_replace($defaults, $stored) : $defaults;
        }

        try {
            $getter = [$this->settings, 'get'];
            $stored = $getter();
            if (is_array($stored)) {
                return array_replace($defaults, $stored);
            }
        } catch (\Throwable $exception) {
            // Support repositories whose get() contract is per-key.
        }

        foreach ($defaults as $key => $value) {
            try {
                $defaults[$key] = $this->settings->get((string) $key, $value);
            } catch (\Throwable $exception) {
                break;
            }
        }

        return $defaults;
    }

    /** @param array<string, mixed> $posted
     *  @return array<string, mixed>
     */
    private function sanitizeChanges(array $posted): array
    {
        $changes = [];

        foreach ([
            'page_cache_enabled',
            'gzip_enabled',
            'minify_css_enabled',
            'minify_js_enabled',
            'defer_js_enabled',
            'lazy_load_enabled',
            'preload_enabled',
            'diagnostics_enabled',
            'remove_data_on_uninstall',
        ] as $key) {
            $changes[$key] = isset($posted[$key]) && is_scalar($posted[$key]) && (string) $posted[$key] === '1';
        }

        $integerRules = [
            'page_cache_ttl' => [60, 604800],
            'browser_cache_ttl' => [0, 86400],
            'preload_batch_size' => [1, 25],
            'log_retention_days' => [1, 30],
        ];
        foreach ($integerRules as $key => [$minimum, $maximum]) {
            if (!isset($posted[$key]) || !is_scalar($posted[$key])) {
                continue;
            }
            $changes[$key] = max($minimum, min($maximum, (int) $posted[$key]));
        }

        if (isset($posted['max_asset_mb']) && is_scalar($posted['max_asset_mb'])) {
            $megabytes = max(0.0625, min(10.0, (float) $posted['max_asset_mb']));
            $changes['max_asset_bytes'] = (int) round($megabytes * 1048576);
        }
        if (isset($posted['max_response_mb']) && is_scalar($posted['max_response_mb'])) {
            $megabytes = max(0.25, min(20.0, (float) $posted['max_response_mb']));
            $changes['max_response_bytes'] = (int) round($megabytes * 1048576);
        }

        foreach (['query_allowlist', 'ignored_query_parameters', 'excluded_paths'] as $key) {
            if (isset($posted[$key]) && is_scalar($posted[$key])) {
                $changes[$key] = sanitize_textarea_field((string) $posted[$key]);
            }
        }

        return $changes;
    }

    /** @return array{files:int,bytes:int} */
    private function cacheStats(): array
    {
        $raw = null;
        try {
            if (method_exists($this->cache, 'stats')) {
                $blogId = function_exists('get_current_blog_id') ? (int) get_current_blog_id() : null;
                $raw = $this->cache->stats($blogId);
            }
        } catch (\Throwable $exception) {
            try {
                // Compatibility with cache stores that expose a zero-argument stats contract.
                $raw = $this->cache->stats();
            } catch (\Throwable $fallbackException) {
                $raw = null;
            }
        }

        if (is_array($raw)) {
            return [
                'files' => max(0, (int) ($raw['files'] ?? $raw['file_count'] ?? $raw['entries'] ?? $raw['count'] ?? 0)),
                'bytes' => max(0, (int) ($raw['bytes'] ?? $raw['size'] ?? $raw['total_bytes'] ?? 0)),
            ];
        }

        if (!method_exists($this->cache, 'baseDirectory')) {
            return ['files' => 0, 'bytes' => 0];
        }

        try {
            $directory = $this->cache->baseDirectory();
            if (!is_string($directory) || !is_dir($directory)) {
                return ['files' => 0, 'bytes' => 0];
            }

            $files = 0;
            $bytes = 0;
            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS)
            );
            foreach ($iterator as $item) {
                if (!$item->isFile()) {
                    continue;
                }
                ++$files;
                $bytes += max(0, (int) $item->getSize());
                if ($files >= 50000) {
                    break;
                }
            }

            return ['files' => $files, 'bytes' => $bytes];
        } catch (\Throwable $exception) {
            return ['files' => 0, 'bytes' => 0];
        }
    }

    /** @return mixed */
    private function purgeCache()
    {
        $blogId = function_exists('get_current_blog_id') ? max(1, (int) get_current_blog_id()) : 1;
        $deleted = $this->invalidator->purgeSite($blogId);

        // CacheInvalidator rotates the logical generation before touching the
        // filesystem and owns pending/retry state. A zero delete count is a
        // valid empty purge only when the physical operation really succeeded
        // and no concurrent invalidation remains pending.
        if (!$this->cache->lastPurgeSucceeded()
            || (function_exists('get_option') && get_option(CacheInvalidator::PENDING_OPTION, false))) {
            return false;
        }

        return $deleted;
    }

    /** @return array<string, mixed> */
    private function preloadStatus(): array
    {
        try {
            $status = $this->preloader->status();

            return is_array($status) ? $status : [];
        } catch (\Throwable $exception) {
            return [];
        }
    }

    /** @return list<array<string, mixed>> */
    private function recentLogs(): array
    {
        try {
            $logs = $this->logger->recent(12);

            return is_array($logs) ? array_values(array_filter($logs, 'is_array')) : [];
        } catch (\Throwable $exception) {
            return [];
        }
    }

    /** @param array<string, mixed> $status */
    private function preloadTranslationKey(array $status): string
    {
        $state = strtolower((string) ($status['state'] ?? $status['status'] ?? 'idle'));
        if (!empty($status['running']) || in_array($state, ['running', 'processing'], true)) {
            return 'preload.running';
        }
        if (!empty($status['scheduled']) || !empty($status['queued']) || in_array($state, ['scheduled', 'queued'], true)) {
            return 'preload.scheduled';
        }

        return 'preload.idle';
    }

    private function currentLocale(): string
    {
        $locale = get_user_meta(get_current_user_id(), self::LOCALE_META_KEY, true);

        return Translator::normalize(is_string($locale) ? $locale : null);
    }

    private function currentTheme(): string
    {
        $theme = get_user_meta(get_current_user_id(), self::THEME_META_KEY, true);

        return in_array($theme, ['dark', 'light'], true) ? (string) $theme : 'dark';
    }

    private function authorize(string $nonceAction): void
    {
        if (!current_user_can(self::CAPABILITY)) {
            wp_die(
                esc_html__('You are not allowed to manage Kodety Rocket.', 'kodety-rocket'),
                '',
                ['response' => 403]
            );
        }

        check_admin_referer($nonceAction, $nonceAction . '_nonce');
    }

    private function redirect(string $notice, string $section): void
    {
        $section = in_array($section, ['overview', 'cache', 'assets', 'delivery', 'diagnostics', 'advanced'], true)
            ? $section
            : 'overview';
        $url = add_query_arg(
            ['page' => self::PAGE_SLUG, 'kodety_rocket_notice' => sanitize_key($notice)],
            admin_url('admin.php')
        );
        wp_safe_redirect($url . '#kodety-rocket-' . $section);
        exit;
    }

    private function postedSection(): string
    {
        return isset($_POST['section']) && is_scalar($_POST['section'])
            ? sanitize_key(wp_unslash((string) $_POST['section']))
            : 'overview';
    }

    /** @param mixed $result */
    private function isError($result): bool
    {
        return function_exists('is_wp_error') && is_wp_error($result);
    }

    /** @param array<string, mixed> $context */
    private function record(string $level, string $event, array $context = []): void
    {
        try {
            if (method_exists($this->logger, $level)) {
                $this->logger->{$level}($event, $context);
            } elseif (method_exists($this->logger, 'record')) {
                $this->logger->record($level, $event, $context);
            }
        } catch (\Throwable $exception) {
            // Admin maintenance must never fail because diagnostics are unavailable.
        }
    }

    private function formatInteger(int $value): string
    {
        return function_exists('number_format_i18n') ? number_format_i18n($value) : number_format($value);
    }

    private function formatBytes(int $bytes): string
    {
        if (function_exists('size_format')) {
            return size_format($bytes, 1);
        }

        return number_format($bytes / 1048576, 1) . ' MB';
    }

    private function formatTimestamp(string $timestamp): string
    {
        $unix = strtotime($timestamp);
        if ($unix === false) {
            return $timestamp !== '' ? $timestamp : '—';
        }

        return function_exists('wp_date') ? wp_date('M j, H:i', $unix) : date('M j, H:i', $unix);
    }

    /** @param array<string, mixed> $context */
    private function formatContext(array $context, bool $short): string
    {
        if ($context === []) {
            return '—';
        }

        $encoded = function_exists('wp_json_encode')
            ? wp_json_encode($context, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
            : json_encode($context, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($encoded)) {
            return '—';
        }

        if (!$short || strlen($encoded) <= 72) {
            return $encoded;
        }

        return substr($encoded, 0, 69) . '…';
    }

    private function renderMetric(
        string $icon,
        string $value,
        string $labelKey,
        string $hintKey,
        string $locale,
        string $valueKey = ''
    ): void {
        ?>
        <div class="kr-metric">
            <span class="kr-metric__icon"><?php echo Icons::icon($icon); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
            <span class="kr-metric__label" data-i18n="<?php echo esc_attr($labelKey); ?>"><?php echo esc_html(Translator::get($labelKey, $locale)); ?></span>
            <strong<?php echo $valueKey !== '' ? ' data-i18n="' . esc_attr($valueKey) . '"' : ''; ?>><?php echo esc_html($value); ?></strong>
            <small data-i18n="<?php echo esc_attr($hintKey); ?>"><?php echo esc_html(Translator::get($hintKey, $locale)); ?></small>
        </div>
        <?php
    }

    private function renderFoundation(string $icon, string $titleKey, string $textKey, string $locale): void
    {
        ?>
        <div class="kr-foundation__item">
            <span><?php echo Icons::icon($icon); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
            <div>
                <strong data-i18n="<?php echo esc_attr($titleKey); ?>"><?php echo esc_html(Translator::get($titleKey, $locale)); ?></strong>
                <p data-i18n="<?php echo esc_attr($textKey); ?>"><?php echo esc_html(Translator::get($textKey, $locale)); ?></p>
            </div>
        </div>
        <?php
    }

    private function renderPanelHeader(
        string $eyebrowKey,
        string $titleKey,
        string $descriptionKey,
        string $icon,
        string $locale,
        string $headingId
    ): void {
        ?>
        <header class="kr-panel-header">
            <div>
                <p class="kr-eyebrow" data-i18n="<?php echo esc_attr($eyebrowKey); ?>"><?php echo esc_html(Translator::get($eyebrowKey, $locale)); ?></p>
                <h1 id="<?php echo esc_attr($headingId); ?>" data-i18n="<?php echo esc_attr($titleKey); ?>"><?php echo esc_html(Translator::get($titleKey, $locale)); ?></h1>
                <p data-i18n="<?php echo esc_attr($descriptionKey); ?>"><?php echo esc_html(Translator::get($descriptionKey, $locale)); ?></p>
            </div>
            <span class="kr-panel-header__icon"><?php echo Icons::icon($icon); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
        </header>
        <?php
    }

    private function renderToggle(
        string $name,
        string $titleKey,
        string $helpKey,
        string $icon,
        bool $enabled,
        string $locale,
        string $badgeKey = ''
    ): void {
        $id = 'kr-setting-' . str_replace('_', '-', $name);
        ?>
        <div class="kr-setting-row kr-setting-row--toggle<?php echo $enabled ? ' is-enabled' : ''; ?>">
            <span class="kr-setting-row__icon"><?php echo Icons::icon($icon); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
            <label class="kr-setting-row__copy" for="<?php echo esc_attr($id); ?>">
                <strong>
                    <span data-i18n="<?php echo esc_attr($titleKey); ?>"><?php echo esc_html(Translator::get($titleKey, $locale)); ?></span>
                    <?php if ($badgeKey !== '') : ?><em data-i18n="<?php echo esc_attr($badgeKey); ?>"><?php echo esc_html(Translator::get($badgeKey, $locale)); ?></em><?php endif; ?>
                </strong>
                <small data-i18n="<?php echo esc_attr($helpKey); ?>"><?php echo esc_html(Translator::get($helpKey, $locale)); ?></small>
            </label>
            <label class="kr-switch" for="<?php echo esc_attr($id); ?>">
                <input id="<?php echo esc_attr($id); ?>" type="checkbox" name="settings[<?php echo esc_attr($name); ?>]" value="1" <?php checked($enabled); ?>>
                <span aria-hidden="true"><i></i></span>
                <span class="screen-reader-text" data-i18n="<?php echo esc_attr($titleKey); ?>"><?php echo esc_html(Translator::get($titleKey, $locale)); ?></span>
            </label>
        </div>
        <?php
    }

    private function renderNumber(
        string $name,
        string $titleKey,
        string $helpKey,
        string $icon,
        int $value,
        int $minimum,
        int $maximum,
        int $step,
        string $unitKey,
        string $locale
    ): void {
        $id = 'kr-setting-' . str_replace('_', '-', $name);
        ?>
        <div class="kr-setting-row">
            <span class="kr-setting-row__icon"><?php echo Icons::icon($icon); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
            <label class="kr-setting-row__copy" for="<?php echo esc_attr($id); ?>">
                <strong data-i18n="<?php echo esc_attr($titleKey); ?>"><?php echo esc_html(Translator::get($titleKey, $locale)); ?></strong>
                <small data-i18n="<?php echo esc_attr($helpKey); ?>"><?php echo esc_html(Translator::get($helpKey, $locale)); ?></small>
            </label>
            <div class="kr-number-control">
                <input id="<?php echo esc_attr($id); ?>" type="number" name="settings[<?php echo esc_attr($name); ?>]" value="<?php echo esc_attr((string) $value); ?>" min="<?php echo esc_attr((string) $minimum); ?>" max="<?php echo esc_attr((string) $maximum); ?>" step="<?php echo esc_attr((string) $step); ?>" inputmode="numeric">
                <?php if ($unitKey !== '') : ?><span data-i18n="<?php echo esc_attr($unitKey); ?>"><?php echo esc_html(Translator::get($unitKey, $locale)); ?></span><?php endif; ?>
            </div>
        </div>
        <?php
    }

    private function renderMegabytes(
        string $name,
        string $titleKey,
        string $helpKey,
        string $icon,
        int $bytes,
        float $minimum,
        float $maximum,
        string $locale
    ): void {
        $id = 'kr-setting-' . str_replace('_', '-', $name);
        $value = rtrim(rtrim(number_format($bytes / 1048576, 4, '.', ''), '0'), '.');
        ?>
        <div class="kr-setting-row">
            <span class="kr-setting-row__icon"><?php echo Icons::icon($icon); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
            <label class="kr-setting-row__copy" for="<?php echo esc_attr($id); ?>">
                <strong data-i18n="<?php echo esc_attr($titleKey); ?>"><?php echo esc_html(Translator::get($titleKey, $locale)); ?></strong>
                <small data-i18n="<?php echo esc_attr($helpKey); ?>"><?php echo esc_html(Translator::get($helpKey, $locale)); ?></small>
            </label>
            <div class="kr-number-control">
                <input id="<?php echo esc_attr($id); ?>" type="number" name="settings[<?php echo esc_attr($name); ?>]" value="<?php echo esc_attr($value); ?>" min="<?php echo esc_attr((string) $minimum); ?>" max="<?php echo esc_attr((string) $maximum); ?>" step="0.0625" inputmode="decimal">
                <span>MB</span>
            </div>
        </div>
        <?php
    }

    /** @param list<mixed> $values */
    private function renderTextarea(
        string $name,
        string $titleKey,
        string $helpKey,
        string $placeholderKey,
        array $values,
        string $locale
    ): void {
        $values = array_values(array_filter(array_map(
            static fn ($value): string => is_scalar($value) ? (string) $value : '',
            $values
        )));
        ?>
        <label class="kr-textarea-field" for="kr-setting-<?php echo esc_attr(str_replace('_', '-', $name)); ?>">
            <span><strong data-i18n="<?php echo esc_attr($titleKey); ?>"><?php echo esc_html(Translator::get($titleKey, $locale)); ?></strong><small data-i18n="<?php echo esc_attr($helpKey); ?>"><?php echo esc_html(Translator::get($helpKey, $locale)); ?></small></span>
            <textarea id="kr-setting-<?php echo esc_attr(str_replace('_', '-', $name)); ?>" name="settings[<?php echo esc_attr($name); ?>]" rows="7" spellcheck="false" placeholder="<?php echo esc_attr(Translator::get($placeholderKey, $locale)); ?>" data-i18n-placeholder="<?php echo esc_attr($placeholderKey); ?>"><?php echo esc_textarea(implode("\n", $values)); ?></textarea>
        </label>
        <?php
    }

    private function renderActionForm(string $id, string $action, string $nonceAction): void
    {
        ?>
        <form class="kr-action-form" id="<?php echo esc_attr($id); ?>" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post">
            <input type="hidden" name="action" value="<?php echo esc_attr($action); ?>">
            <?php wp_nonce_field($nonceAction, $nonceAction . '_nonce', false); ?>
        </form>
        <?php
    }
}
