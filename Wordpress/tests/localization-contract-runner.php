<?php

/**
 * Thin process boundary for the cross-runtime localization contract.
 *
 * The fixture and all assertions live in the Node test. This runner only loads
 * the exact WordPress theme runtime and returns one rendered document per
 * locale, preventing a second PHP-only fixture from drifting over time.
 */
define('ABSPATH', __DIR__);

class WP_Post {}

function add_action(...$arguments): void {}
function add_filter(...$arguments): void {}
function add_theme_support(...$arguments): void {}
function get_option(string $key, mixed $default = false): mixed { return $default; }
function get_template_directory(): string { return sys_get_temp_dir(); }
function home_url(string $path = ''): string { return 'https://contract.example/' . ltrim($path, '/'); }
function user_trailingslashit(string $value): string { return rtrim($value, '/') . '/'; }
function esc_attr(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

require dirname(__DIR__) . '/kodety/theme-runtime/functions.php';

$fixture_path = (string) ($argv[1] ?? '');
$fixture = $fixture_path !== '' && is_file($fixture_path)
    ? json_decode((string) file_get_contents($fixture_path), true)
    : null;

if (!is_array($fixture)) {
    fwrite(STDERR, "Unable to read localization contract fixture.\n");
    exit(2);
}

$source = (string) ($fixture['source'] ?? '');
$page_path = (string) ($fixture['pagePath'] ?? '');
$settings = is_array($fixture['settings'] ?? null) ? $fixture['settings'] : [];
$outputs = [];

foreach ((array) ($fixture['locales'] ?? []) as $locale_code) {
    if (!is_string($locale_code) || $locale_code === '') continue;
    $outputs[$locale_code] = base64_encode(
        kodety_render_localized_html($source, $page_path, $locale_code, $settings)
    );
}
foreach ((array) ($fixture['additionalCases'] ?? []) as $case) {
    if (!is_array($case)) continue;
    $id = is_string($case['id'] ?? null) ? $case['id'] : '';
    $locale_code = is_string($case['locale'] ?? null) ? $case['locale'] : '';
    $case_page_path = is_string($case['pagePath'] ?? null) ? $case['pagePath'] : '';
    if ($id === '' || $locale_code === '' || $case_page_path === '') continue;
    $outputs['case:' . $id] = base64_encode(
        kodety_render_localized_html($source, $case_page_path, $locale_code, $settings)
    );
}

$encoded = json_encode($outputs, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
if (!is_string($encoded)) {
    fwrite(STDERR, "Unable to encode localization contract output.\n");
    exit(3);
}

fwrite(STDOUT, $encoded);
