<?php

declare(strict_types=1);

namespace KodetyRocket\Settings;

/**
 * Owns all persistent settings for Kodety Rocket.
 *
 * Values are deliberately conservative. Every optimization except the strongly
 * gated page cache is opt-in, and unknown keys are never persisted.
 */
final class SettingsRepository
{
    public const OPTION_NAME = 'kodety_rocket_settings';
    public const BACKUP_OPTION_NAME = 'kodety_rocket_settings_backup';
    public const SCHEMA_VERSION = 1;

    /** @var array<string, mixed> */
    private const DEFAULT_VALUES = [
        'schema_version' => self::SCHEMA_VERSION,
        'locale' => 'en_US',
        'theme' => 'system',
        'page_cache_enabled' => true,
        'page_cache_ttl' => 3600,
        'browser_cache_ttl' => 300,
        'gzip_enabled' => true,
        'minify_css_enabled' => false,
        'minify_js_enabled' => false,
        'defer_js_enabled' => false,
        'lazy_load_enabled' => false,
        'preload_enabled' => false,
        'preload_batch_size' => 5,
        'query_allowlist' => [],
        'ignored_query_parameters' => [
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_term',
            'utm_content',
            'gclid',
            'fbclid',
        ],
        'excluded_paths' => [
            '/wp-admin/',
            '/wp-login.php',
            '/cart/',
            '/checkout/',
            '/my-account/',
        ],
        'max_asset_bytes' => 1048576,
        'max_response_bytes' => 5242880,
        'diagnostics_enabled' => false,
        'log_retention_days' => 7,
        'remove_data_on_uninstall' => false,
    ];

    public function register(): void
    {
        if (!function_exists('register_setting')) {
            return;
        }

        register_setting(
            'kodety_rocket',
            self::OPTION_NAME,
            [
                'type' => 'object',
                'default' => $this->defaults(),
                'sanitize_callback' => [$this, 'sanitizeOption'],
                'show_in_rest' => false,
            ]
        );
    }

    /** @return array<string, mixed> */
    public function defaults(): array
    {
        return self::DEFAULT_VALUES;
    }

    /** @return array<string, mixed> */
    public function all(): array
    {
        $stored = function_exists('get_option') ? get_option(self::OPTION_NAME, []) : [];

        if (!is_array($stored)) {
            $stored = [];
        }

        return $this->sanitize(array_replace($this->defaults(), $stored));
    }

    /** @return mixed */
    public function get(string $key, $fallback = null)
    {
        $settings = $this->all();

        return array_key_exists($key, $settings) ? $settings[$key] : $fallback;
    }

    /**
     * WordPress register_setting() callback.
     *
     * @param mixed $value
     * @return array<string, mixed>
     */
    public function sanitizeOption($value): array
    {
        $current = $this->all();

        return $this->sanitize(is_array($value) ? array_replace($current, $value) : $current);
    }

    /**
     * @param array<string, mixed> $changes
     * @return array<string, mixed>|\WP_Error
     */
    public function update(array $changes)
    {
        if (!function_exists('update_option')) {
            return $this->error('storage_unavailable', 'WordPress option storage is unavailable.');
        }

        $previous = $this->all();
        $next = $this->sanitize(array_replace($previous, $changes));

        if ($next === $previous) {
            return $next;
        }

        update_option(
            self::BACKUP_OPTION_NAME,
            [
                'settings' => $previous,
                'created_at' => time(),
            ],
            false
        );

        update_option(self::OPTION_NAME, $next, false);
        $verified = $this->all();

        if ($verified !== $next) {
            update_option(self::OPTION_NAME, $previous, false);

            return $this->error('settings_write_failed', 'Kodety Rocket could not safely persist the settings.');
        }

        return $verified;
    }

    /** @return array<string, mixed>|\WP_Error */
    public function rollback()
    {
        if (!function_exists('get_option') || !function_exists('update_option')) {
            return $this->error('storage_unavailable', 'WordPress option storage is unavailable.');
        }

        $backup = get_option(self::BACKUP_OPTION_NAME, []);
        if (!is_array($backup) || !isset($backup['settings']) || !is_array($backup['settings'])) {
            return $this->error('backup_unavailable', 'There is no valid Kodety Rocket settings backup.');
        }

        $current = $this->all();
        $restored = $this->sanitize($backup['settings']);

        update_option(self::OPTION_NAME, $restored, false);
        if ($this->all() !== $restored) {
            update_option(self::OPTION_NAME, $current, false);

            return $this->error('rollback_failed', 'Kodety Rocket could not restore the previous settings.');
        }

        update_option(
            self::BACKUP_OPTION_NAME,
            ['settings' => $current, 'created_at' => time()],
            false
        );

        return $restored;
    }

    /** @return array<string, mixed>|\WP_Error */
    public function reset()
    {
        return $this->update($this->defaults());
    }

    /** @param array<string, mixed> $input
     *  @return array<string, mixed>
     */
    public function sanitize(array $input): array
    {
        $defaults = $this->defaults();
        $output = $defaults;

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
        ] as $booleanKey) {
            $output[$booleanKey] = $this->toBoolean($input[$booleanKey] ?? $defaults[$booleanKey]);
        }

        $output['schema_version'] = self::SCHEMA_VERSION;
        $output['locale'] = in_array(($input['locale'] ?? ''), ['en_US', 'pt_BR', 'es_ES'], true)
            ? (string) $input['locale']
            : $defaults['locale'];
        $output['theme'] = in_array(($input['theme'] ?? ''), ['system', 'light', 'dark'], true)
            ? (string) $input['theme']
            : $defaults['theme'];

        $output['page_cache_ttl'] = $this->boundedInteger($input['page_cache_ttl'] ?? null, 60, 604800, 3600);
        $output['browser_cache_ttl'] = $this->boundedInteger($input['browser_cache_ttl'] ?? null, 0, 86400, 300);
        $output['preload_batch_size'] = $this->boundedInteger($input['preload_batch_size'] ?? null, 1, 25, 5);
        $output['max_asset_bytes'] = $this->boundedInteger($input['max_asset_bytes'] ?? null, 65536, 10485760, 1048576);
        $output['max_response_bytes'] = $this->boundedInteger($input['max_response_bytes'] ?? null, 262144, 20971520, 5242880);
        $output['log_retention_days'] = $this->boundedInteger($input['log_retention_days'] ?? null, 1, 30, 7);

        $output['query_allowlist'] = $this->sanitizeParameterList($input['query_allowlist'] ?? []);
        $output['ignored_query_parameters'] = $this->sanitizeParameterList($input['ignored_query_parameters'] ?? $defaults['ignored_query_parameters']);
        $output['excluded_paths'] = $this->sanitizePathList($input['excluded_paths'] ?? $defaults['excluded_paths']);

        return $output;
    }

    /** @param mixed $value */
    private function toBoolean($value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_string($value)) {
            return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
        }

        return (bool) $value;
    }

    /** @param mixed $value */
    private function boundedInteger($value, int $minimum, int $maximum, int $fallback): int
    {
        $integer = filter_var($value, FILTER_VALIDATE_INT);
        if ($integer === false) {
            return $fallback;
        }

        return max($minimum, min($maximum, (int) $integer));
    }

    /**
     * @param mixed $value
     * @return list<string>
     */
    private function sanitizeParameterList($value): array
    {
        $items = $this->listFromValue($value);
        $clean = [];

        foreach ($items as $item) {
            $item = strtolower(trim($item));
            if ($item !== '' && preg_match('/^[a-z0-9_.-]{1,64}$/', $item) === 1) {
                $clean[] = $item;
            }
        }

        $clean = array_values(array_unique($clean));
        sort($clean, SORT_STRING);

        return array_slice($clean, 0, 100);
    }

    /**
     * @param mixed $value
     * @return list<string>
     */
    private function sanitizePathList($value): array
    {
        $items = $this->listFromValue($value);
        $clean = [];

        foreach ($items as $item) {
            $item = trim(str_replace(["\0", "\r", "\n"], '', $item));
            if ($item === '') {
                continue;
            }

            $path = parse_url($item, PHP_URL_PATH);
            if (!is_string($path) || $path === '') {
                continue;
            }

            $path = '/' . ltrim($path, '/');
            $clean[] = substr($path, 0, 255);
        }

        return array_slice(array_values(array_unique($clean)), 0, 100);
    }

    /**
     * @param mixed $value
     * @return list<string>
     */
    private function listFromValue($value): array
    {
        if (is_string($value)) {
            $value = preg_split('/[\r\n,]+/', $value) ?: [];
        }

        if (!is_array($value)) {
            return [];
        }

        return array_values(array_filter(array_map(
            static fn ($item): string => is_scalar($item) ? (string) $item : '',
            $value
        ), static fn (string $item): bool => $item !== ''));
    }

    /** @return \WP_Error */
    private function error(string $code, string $message)
    {
        if (class_exists('WP_Error')) {
            return new \WP_Error($code, $message);
        }

        // WordPress is always present in production; this keeps isolated smoke
        // tests deterministic without weakening the public contract.
        throw new \RuntimeException($message);
    }
}
