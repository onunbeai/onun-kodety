<?php

declare(strict_types=1);

namespace KodetyRocket\Optimization;

use KodetyRocket\Diagnostics\Logger;
use KodetyRocket\Settings\SettingsRepository;

/** Adds native lazy-loading without parsing HTML through a lossy DOM round-trip. */
final class LazyLoadTransformer
{
    private SettingsRepository $settings;
    private Logger $logger;

    public function __construct(SettingsRepository $settings, Logger $logger)
    {
        $this->settings = $settings;
        $this->logger = $logger;
    }

    public function __invoke(string $html): string
    {
        if (!(bool) $this->settings->get('lazy_load_enabled', false)
            || (defined('KODETY_ROCKET_BYPASS') && (bool) KODETY_ROCKET_BYPASS)
            || !class_exists('WP_HTML_Tag_Processor')) {
            return $html;
        }

        try {
            $processor = new \WP_HTML_Tag_Processor($html);
            $skipImages = function_exists('apply_filters')
                ? max(0, (int) apply_filters('kodety_rocket_lazy_load_skip_first_images', 1))
                : 1;
            $eligibleImages = 0;

            while ($processor->next_tag()) {
                $tag = strtoupper((string) $processor->get_tag());
                if ($tag !== 'IMG' && $tag !== 'IFRAME') {
                    continue;
                }

                if ($processor->get_attribute('data-kodety-rocket-no-lazy') !== null
                    || strtolower((string) $processor->get_attribute('loading')) === 'eager'
                    || strtolower((string) $processor->get_attribute('fetchpriority')) === 'high') {
                    continue;
                }

                $source = (string) $processor->get_attribute('src');
                if ($source === '' || stripos($source, 'data:') === 0 || stripos($source, 'blob:') === 0) {
                    continue;
                }

                if ($tag === 'IMG') {
                    ++$eligibleImages;
                    if ($eligibleImages <= $skipImages) {
                        continue;
                    }

                    if ($processor->get_attribute('decoding') === null) {
                        $processor->set_attribute('decoding', 'async');
                    }
                }

                if ($processor->get_attribute('loading') === null
                    || strtolower((string) $processor->get_attribute('loading')) === 'auto') {
                    $processor->set_attribute('loading', 'lazy');
                }
            }

            return $processor->get_updated_html();
        } catch (\Throwable $exception) {
            $this->logger->warning('Native lazy-load transformation failed open.', ['exception' => $exception]);

            return $html;
        }
    }
}
