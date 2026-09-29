<?php
/** Imported asset grammar must survive media sync and the published theme. */
declare(strict_types=1);
define('ABSPATH', __DIR__);
function add_action(string $name, mixed $callback, int $priority = 10, int $arguments = 1): bool { return true; }
function add_filter(string $name, mixed $callback, int $priority = 10, int $arguments = 1): bool { return true; }
function apply_filters(string $name, mixed $value, mixed ...$arguments): mixed { return $value; }
function esc_url(string $url): string { return htmlspecialchars($url, ENT_QUOTES, 'UTF-8'); }
require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';
require dirname(__DIR__) . '/kodety/theme-runtime/functions.php';
function assert_published_asset(bool $value, string $message): void {
    if (!$value) throw new RuntimeException($message);
}
$root = sys_get_temp_dir() . '/kodety-published-asset-syntax-' . bin2hex(random_bytes(5));
mkdir($root . '/pages', 0777, true);
mkdir($root . '/styles', 0777, true);
$inline = 'data:image/svg+xml,%3Csvg,%3E';
$remote = 'https://cdn.example.test/image,wide.png';
$script = 'const template=`<img srcset="data:image/png;base64,AAAA 1x, /assets/hero,wide.png 2x">`;';
$embedded_css = '.preview{background:url("/assets/hero(small).png")} .preview::after{content:\'srcset="/assets/hero,wide.png 2x"\'}';
$html = '<!doctype html><html><head><link rel="preload" as="image" imagesrcset = "' . $inline . ' 1x, /assets/hero,wide.png 2x">'
    . '<style>' . $embedded_css . '</style></head><body>'
    . '<img id="photo" src="../assets/hero(small).png" srcset="' . $inline . ' 1x, ../assets/hero,wide.png?rev=2#crop 2x, ' . $remote . ' 3x">'
    . '<picture><source data-srcset="/assets/hero,wide.png 400w, ../assets/hero(small).png 800w" data-lazy-srcset=\'/assets/hero,wide.png 1x, //cdn.example.test/a,b.png 2x\'></picture>'
    . '<img id="root-only" srcset="/assets/unmapped,wide.png 1x, ' . $inline . ' 2x">'
    . '<script>' . $script . '</script></body></html>';
$css_literal = '.literal::after{content:\'srcset="../assets/hero,wide.png 2x" url(../assets/hero(small).png)\'}';
$css = '/* url(../assets/hero,wide.png) */' . $css_literal
    . '.card{background:image-set("../assets/hero,wide.png" 1x type("image/png"),url("../assets/hero(small).png") 2x)}'
    . '.escaped{mask:url(../assets/hero\\(small\\).png#shape)}'
    . '.inline{background:url("' . $inline . '")}';
$canonical = $root . '/canonical.json';
file_put_contents($canonical, json_encode(['files' => ['pages/index.html' => ['text' => $html], 'styles/site.css' => ['text' => $css]]], JSON_THROW_ON_ERROR));
file_put_contents($root . '/pages/index.html', $html);
file_put_contents($root . '/styles/site.css', $css);
$before = (string) file_get_contents($canonical);
$map = ['assets/hero,wide.png' => 'https://wp.example.test/uploads/hero-wide-hash.png', 'assets/hero(small).png' => 'https://wp.example.test/uploads/hero-small-hash.png'];
try {
    $reflection = new ReflectionClass(Kodety_Plugin::class);
    $plugin = $reflection->newInstanceWithoutConstructor();
    $rewrite = $reflection->getMethod('rewrite_theme_asset_references');
    $rewrite->invoke($plugin, $root, $map);
    $published = (string) file_get_contents($root . '/pages/index.html');
    $published_css = (string) file_get_contents($root . '/styles/site.css');
    assert_published_asset(str_contains($published, $inline . ' 1x, ' . $map['assets/hero,wide.png'] . '?rev=2#crop 2x, ' . $remote . ' 3x'), 'Publisher must preserve complete inline/CDN candidates and map comma-containing local paths with query/hash.');
    assert_published_asset(str_contains($published, 'imagesrcset = "' . $inline . ' 1x, ' . $map['assets/hero,wide.png'] . ' 2x"'), 'Image preload srcset must use mapped media without damaging the data URL.');
    assert_published_asset(str_contains($published, 'data-srcset="' . $map['assets/hero,wide.png'] . ' 400w, ' . $map['assets/hero(small).png'] . ' 800w"'), 'Lazy responsive candidates must follow published media paths.');
    assert_published_asset(str_contains($published, 'data-lazy-srcset=\'' . $map['assets/hero,wide.png'] . ' 1x, //cdn.example.test/a,b.png 2x\''), 'Lazy variants and protocol-relative CDN URLs must preserve their boundaries.');
    assert_published_asset(str_contains($published, $script) && str_contains($published, $embedded_css), 'Inline JavaScript and CSS payloads must stay byte-identical during media sync.');
    assert_published_asset(str_contains($published_css, 'image-set("' . $map['assets/hero,wide.png'] . '" 1x type("image/png"),url("' . $map['assets/hero(small).png'] . '") 2x)'), 'External CSS must map image-set and quoted parentheses with valid CSS grammar.');
    assert_published_asset(str_contains($published_css, 'mask:url("' . $map['assets/hero(small).png'] . '#shape")'), 'CSS escaped URL characters must resolve to their real media path.');
    assert_published_asset(str_contains($published_css, $css_literal) && str_contains($published_css, '/* url(../assets/hero,wide.png) */') && str_contains($published_css, 'url("' . $inline . '")'), 'CSS comments, strings and data URLs must stay untouched.');
    assert_published_asset(file_get_contents($canonical) === $before, 'Publishing media references must never rewrite canonical JSON project data.');
    $rewrite->invoke($plugin, $root, $map);
    assert_published_asset(file_get_contents($root . '/pages/index.html') === $published && file_get_contents($root . '/styles/site.css') === $published_css, 'Repeated native reconciliation must be idempotent.');

    // Execute the actual root-URL rewrite block shipped by index.php, isolated
    // from unrelated WordPress query/SEO hooks, including its raw-text shields.
    $index = (string) file_get_contents(dirname(__DIR__) . '/kodety/theme-runtime/index.php');
    $start = strpos($index, '[$html, $runtime_raw_text_payloads] = kodety_protect_runtime_raw_text_payloads($html);');
    $end_marker = '$html = kodety_restore_runtime_raw_text_payloads($html, $runtime_raw_text_payloads);';
    $end = strpos($index, $end_marker, $start ?: 0);
    assert_published_asset($start !== false && $end !== false, 'Published root URL rewrite boundary must remain identifiable.');
    $runtime = substr($index, $start, $end + strlen($end_marker) - $start);
    $site_uri = 'https://wp.example.test/theme/site/';
    eval($runtime);
    assert_published_asset(str_contains($html, 'srcset="' . $inline . ' 1x, ../assets/hero,wide.png?rev=2#crop 2x, ' . $remote . ' 3x"'), 'Runtime must preserve inline/CDN/relative candidates without introducing separators into their URLs.');
    assert_published_asset(str_contains($html, 'imagesrcset = "' . $inline . ' 1x, ' . $site_uri . 'assets/hero,wide.png 2x"'), 'Runtime image preload candidates must target the project web root.');
    assert_published_asset(str_contains($html, 'data-srcset="' . $site_uri . 'assets/hero,wide.png 400w, ../assets/hero(small).png 800w"'), 'Runtime lazy srcset must rewrite root URLs only.');
    assert_published_asset(str_contains($html, $script) && str_contains($html, $embedded_css), 'Published request rewriting must preserve raw scripts/styles exactly.');
    $spaced = "  " . $inline . " 1x,\n /assets/a,b.png\t2x,  //cdn.example.test/c,d.png 3x  ";
    $mapped = kodety_runtime_map_srcset($spaced, static fn(string $url): string => $url === '/assets/a,b.png' ? '/mapped.png' : $url);
    assert_published_asset($mapped === str_replace('/assets/a,b.png', '/mapped.png', $spaced), 'Standalone theme tokenizer must preserve authored whitespace, descriptor and data bytes.');
    assert_published_asset(kodety_runtime_map_srcset('a.png, b.png,', static fn(string $url): string => strtoupper($url)) === 'A.PNG, B.PNG,', 'Descriptor-free candidates with trailing commas must preserve valid token boundaries.');
    fwrite(STDOUT, "Published asset syntax: srcset/data/CDN, lazy/preload, CSS/image-set, raw text, canonical isolation and repeat sync passed.\n");
} finally {
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($files as $file) { if ($file->isDir()) rmdir($file->getPathname()); else unlink($file->getPathname()); }
    rmdir($root);
}
