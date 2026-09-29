<?php

defined('ABSPATH') || exit;

/** Retained for extensions that catch this historical exception type. */
final class Kodety_Pro_Feature_Exception extends RuntimeException {
    private string $feature;
    public function __construct(string $feature, string $message) { parent::__construct($message); $this->feature = $feature; }
    public function feature(): string { return $this->feature; }
}

/** Installed capabilities, independent of subscriptions or activation keys. */
final class Kodety_Edition {
    // Historical serialized API value; Onun Kodety has a single open edition.
    public const PRO = 'pro';
    public static function slug(): string { return self::PRO; }
    public static function is_unlicensed(): bool { return false; }
    public static function is_pro(): bool { return true; }
    public static function is_licensed(): bool { return true; }

    private static function policy(): array {
        static $policy = null;
        if ($policy === null) {
            $decoded = json_decode((string) file_get_contents(__DIR__ . '/product-policy.json'), true);
            $policy = is_array($decoded) ? $decoded : [];
        }
        return $policy;
    }

    public static function features(bool $force_unlicensed = false): array {
        $localization = function_exists('apply_filters') && apply_filters('kodety_localization_extension_enabled', false) === true;
        $features = [];
        foreach (self::policy()['features'] ?? [] as $name => $rule) {
            $features[$name] = $rule === 'localization' ? $localization : true;
        }
        return $features;
    }

    public static function has(string $feature): bool { return !empty(self::features()[$feature]); }
    public static function limits(): array { return array_fill_keys(array_keys(self::policy()['licensedLimits'] ?? []), null); }
    public static function limit(string $name): ?int { return null; }
    public static function upgrade_url(): string { return ''; }
    public static function license_url(): string { return ''; }

    public static function public_config(): array {
        return [
            'edition' => self::slug(), 'licensed' => true, 'licenseStatus' => 'open-source',
            'licensePlan' => '', 'licenseIsTrial' => false, 'licenseTrialExpired' => false,
            'licenseExpiresAt' => '', 'licenseServerTime' => gmdate('c'), 'licenseStatusUrl' => '',
            'unlicensedFeatures' => self::features(), 'unlicensedLimits' => self::limits(),
            'features' => self::features(), 'limits' => self::limits(), 'upgradeUrl' => '', 'licenseUrl' => '',
        ];
    }

    public static function visible_collection_definitions(array $definitions): array { return array_values(array_filter($definitions, 'is_array')); }
    public static function collection_limit_error(array $definitions): ?WP_Error { return null; }
    public static function item_limit_error(string $post_type): ?WP_Error { return null; }
    public static function item_count(string $post_type): int {
        if (!function_exists('wp_count_posts')) return 0;
        $counts = wp_count_posts($post_type);
        if (!is_object($counts)) return 0;
        $total = 0;
        foreach (get_object_vars($counts) as $status => $count) {
            if (!in_array($status, ['trash', 'auto-draft', 'inherit'], true)) $total += max(0, (int) $count);
        }
        return $total;
    }
    public static function assert_project_collection_connections(array $html_files, array $collection_slugs): void {}
    public static function assert_cookie_consent_activation(array $html_files): void {}
    public static function assert_analytics_pro_activation(array $html_files, string $project_root): void {}
}
