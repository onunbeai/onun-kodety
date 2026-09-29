<?php

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');

function trailingslashit(string $value): string {
    return rtrim($value, '/\\') . '/';
}

require_once dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function expect_same(string $expected, string $actual, string $message): void {
    if ($expected === $actual) return;
    fwrite(STDERR, $message . "\nExpected: " . $expected . "\nActual:   " . $actual . "\n");
    exit(1);
}

$root = sys_get_temp_dir() . '/kodety-agency-assets-' . bin2hex(random_bytes(6));
$asset_directory = $root . '/site/assets/imported';
if (!mkdir($asset_directory, 0777, true) && !is_dir($asset_directory)) {
    fwrite(STDERR, "Could not create the agency asset fixture.\n");
    exit(1);
}
file_put_contents($asset_directory . '/brand logo.svg', '<svg/>');
file_put_contents($asset_directory . '/hero.png', 'png');

$plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();
$method = new ReflectionMethod(Kodety_Plugin::class, 'agency_rewrite_managed_asset_urls');
$method->setAccessible(true);
$mime_method = new ReflectionMethod(Kodety_Plugin::class, 'asset_mime_type');
$mime_method->setAccessible(true);

$source = <<<'HTML'
<img src="https://example.test/wp-content/uploads/kodety/assets/assets/imported/brand%20logo-aabbccddeeff.svg">
<img srcset="/wp-content/uploads/kodety/assets/assets/imported/hero-112233aabbcc.png 1x, /ordinary/image.png 2x">
<style>.hero{background:url("/wp-content/uploads/kodety/assets/assets/imported/hero-112233aabbcc.png?size=large")}</style>
<script>window.logo="/wp-content/uploads/kodety/assets/assets/imported/brand%20logo-aabbccddeeff.svg";window.route="/about";</script>
HTML;

$actual = $method->invoke(
    $plugin,
    $source,
    $root,
    'https://example.test/kodety-site-assets/studio'
);
$expected = <<<'HTML'
<img src="https://example.test/kodety-site-assets/studio/site/assets/imported/brand%20logo.svg">
<img srcset="https://example.test/kodety-site-assets/studio/site/assets/imported/hero.png 1x, /ordinary/image.png 2x">
<style>.hero{background:url("https://example.test/kodety-site-assets/studio/site/assets/imported/hero.png?size=large")}</style>
<script>window.logo="https://example.test/kodety-site-assets/studio/site/assets/imported/brand%20logo.svg";window.route="/about";</script>
HTML;
expect_same($expected, $actual, 'Agency publication must keep HTML, srcset, CSS and runtime image URLs inside the project snapshot.');

$missing = '<img src="/wp-content/uploads/kodety/assets/assets/imported/missing-aabbccddeeff.svg"><a href="/about">About</a>';
expect_same(
    $missing,
    $method->invoke($plugin, $missing, $root, 'https://example.test/kodety-site-assets/studio'),
    'Unknown managed URLs and public navigation routes must not be rewritten.'
);
expect_same(
    'image/svg+xml',
    $mime_method->invoke($plugin, $asset_directory . '/brand logo.svg'),
    'Agency assets must serve SVG files with an image MIME instead of application/octet-stream.'
);

unlink($asset_directory . '/brand logo.svg');
unlink($asset_directory . '/hero.png');
rmdir($asset_directory);
rmdir(dirname($asset_directory));
rmdir(dirname(dirname($asset_directory)));
rmdir($root);

echo "Agency asset runtime checks passed.\n";
