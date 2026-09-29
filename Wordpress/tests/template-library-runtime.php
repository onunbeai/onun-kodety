<?php

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
define('MB_IN_BYTES', 1024 * 1024);
define('WP_CONTENT_DIR', sys_get_temp_dir());
define('KODETY_DIR', dirname(__DIR__) . '/kodety/');
define('KODETY_URL', 'https://example.test/wp-content/plugins/kodety/');
define('KODETY_VERSION', 'test');

$root = sys_get_temp_dir() . '/kodety-template-library-' . bin2hex(random_bytes(5));
$user = $root . '/kodety/private/templates/studio-template';
$external = $root . '/external-commerce';
mkdir($user . '/project/.incode', 0777, true);
mkdir($external, 0777, true);
file_put_contents($user . '/project/index.html', '<!doctype html><html><body><h1>Studio</h1></body></html>');
file_put_contents($user . '/project/about.html', '<!doctype html><html><body><h1>About</h1></body></html>');
file_put_contents($user . '/template.json', json_encode([
    'schemaVersion' => 1,
    'slug' => 'studio-template',
    'name' => 'Studio Template',
    'description' => 'Reusable portfolio site.',
    'category' => 'portfolio',
]));
file_put_contents($external . '/index.html', '<!doctype html><html><body><h1>Commerce</h1></body></html>');

function wp_upload_dir(): array { global $root; return ['basedir' => $root]; }
function trailingslashit(string $value): string { return rtrim($value, '/\\') . '/'; }
function add_action(...$args): void {}
function apply_filters(string $hook, mixed $value): mixed {
    global $external;
    if ($hook !== 'kodety_template_library_sources') return $value;
    $value[] = [
        'slug' => 'commerce-extension',
        'name' => 'Commerce Extension',
        'description' => 'Commerce from an extension.',
        'category' => 'ecommerce',
        'sourcePath' => $external,
        'origin' => 'extension',
        'featured' => true,
    ];
    return $value;
}
function sanitize_key(string $value): string { return strtolower((string) preg_replace('/[^a-z0-9_-]/i', '', $value)); }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function sanitize_textarea_field(string $value): string { return trim(strip_tags($value)); }
function absint(mixed $value): int { return abs((int) $value); }

final class Kodety_Plugin {
    public const CAP_EDIT_WORKSPACE = 'kodety_edit';
}

require_once KODETY_DIR . 'includes/class-kodety-template-library.php';

$templates = Kodety_Template_Library::instance()->templates();
if (count($templates) !== 2) throw new RuntimeException('Expected uploaded and extension templates.');
if (($templates[0]['slug'] ?? '') !== 'commerce-extension') throw new RuntimeException('Featured template must be first.');
$uploaded = array_values(array_filter($templates, static fn(array $item): bool => $item['slug'] === 'studio-template'))[0] ?? null;
if (!is_array($uploaded) || $uploaded['pages'] !== 2 || $uploaded['sourceLabel'] !== 'Seu template') {
    throw new RuntimeException('Uploaded template metadata was not normalized.');
}

$remove = static function (string $directory) use (&$remove): void {
    if (!is_dir($directory)) return;
    foreach (scandir($directory) ?: [] as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $directory . '/' . $item;
        if (is_dir($path)) $remove($path); else unlink($path);
    }
    rmdir($directory);
};
$remove($root);

echo "Template library runtime checks passed.\n";
