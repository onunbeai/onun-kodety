<?php

declare(strict_types=1);

namespace KodetyRocket\Optimization;

use KodetyRocket\Http\RequestGate;
use KodetyRocket\Settings\SettingsRepository;

/** Adds defer exclusively at WordPress' script_loader_tag boundary. */
final class DeferScripts
{
    private SettingsRepository $settings;
    private ?RequestGate $requestGate;

    public function __construct(SettingsRepository $settings, ?RequestGate $requestGate = null)
    {
        $this->settings = $settings;
        $this->requestGate = $requestGate;
    }

    public function register(): void
    {
        if (function_exists('add_filter')) {
            add_filter('script_loader_tag', [$this, 'filter'], 20, 3);
        }
    }

    public function filter(string $tag, string $handle, string $src = ''): string
    {
        if (!(bool) $this->settings->get('defer_js_enabled', false)
            || (defined('KODETY_ROCKET_BYPASS') && (bool) KODETY_ROCKET_BYPASS)
            || ($this->requestGate !== null && !$this->requestGate->allowsTransformations())
            || (function_exists('is_admin') && is_admin())
            || $this->isExcludedHandle($handle)
            || $this->mustRemainBlocking($handle)
            || preg_match('/\s(?:defer|async)(?:\s|=|>)/i', $tag) === 1
            || preg_match('/\snomodule(?:\s|=|>)/i', $tag) === 1
            || preg_match('/\stype\s*=\s*(?:["\'](?:module|importmap|speculationrules)["\']|(?:module|importmap|speculationrules)(?=\s|>))/i', $tag) === 1
            || stripos($tag, '<script') === false
            || stripos($tag, 'src=') === false) {
            return $tag;
        }

        if (class_exists('WP_HTML_Tag_Processor')) {
            try {
                $processor = new \WP_HTML_Tag_Processor($tag);
                if ($processor->next_tag(['tag_name' => 'SCRIPT'])) {
                    $processor->set_attribute('defer', 'defer');

                    return $processor->get_updated_html();
                }
            } catch (\Throwable $exception) {
                return $tag;
            }
        }

        $updated = preg_replace('/<script\b/i', '<script defer="defer"', $tag, 1);

        return is_string($updated) ? $updated : $tag;
    }

    private function isExcludedHandle(string $handle): bool
    {
        $normalized = strtolower($handle);
        $excluded = preg_match('/(^|[-_])jquery(?:[-_]|$)/', $normalized) === 1
            || in_array($normalized, ['jquery', 'jquery-core', 'jquery-migrate', 'wp-polyfill'], true);

        return function_exists('apply_filters')
            ? (bool) apply_filters('kodety_rocket_defer_excluded', $excluded, $handle)
            : $excluded;
    }

    private function mustRemainBlocking(string $handle): bool
    {
        global $wp_scripts;

        if (!is_object($wp_scripts) || !isset($wp_scripts->registered) || !is_array($wp_scripts->registered)) {
            return false;
        }

        $blocking = [];
        $queue = [];
        foreach ($wp_scripts->registered as $registeredHandle => $dependency) {
            if (!is_object($dependency)) {
                continue;
            }
            $extra = isset($dependency->extra) && is_array($dependency->extra) ? $dependency->extra : [];
            $hasInline = !empty($extra['before']) || !empty($extra['after']) || !empty($extra['conditional']);
            if ($hasInline || $this->isExcludedHandle((string) $registeredHandle)) {
                $blocking[(string) $registeredHandle] = true;
                $queue[] = (string) $registeredHandle;
            }
        }

        // Any dependency of a blocking/inline consumer must also remain
        // blocking; otherwise the consumer can execute before its dependency.
        while ($queue !== []) {
            $current = (string) array_shift($queue);
            $dependency = $wp_scripts->registered[$current] ?? null;
            $dependencies = is_object($dependency) && isset($dependency->deps) && is_array($dependency->deps)
                ? $dependency->deps
                : [];
            foreach ($dependencies as $dependencyHandle) {
                $dependencyHandle = (string) $dependencyHandle;
                if ($dependencyHandle !== '' && !isset($blocking[$dependencyHandle])) {
                    $blocking[$dependencyHandle] = true;
                    $queue[] = $dependencyHandle;
                }
            }
        }

        $mustBlock = isset($blocking[$handle]);

        return function_exists('apply_filters')
            ? (bool) apply_filters('kodety_rocket_defer_must_remain_blocking', $mustBlock, $handle)
            : $mustBlock;
    }
}
