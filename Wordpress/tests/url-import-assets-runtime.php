<?php
/** Behavioral coverage for generic/Webflow import URL resolution and portable asset ZIPs. */
define('ABSPATH', __DIR__);
define('MB_IN_BYTES', 1024 * 1024);
final class WP_Error {
    public function __construct(private string $code, private string $message = '', private mixed $data = null) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}
$GLOBALS['asset_fixtures'] = [];
$GLOBALS['asset_requests'] = [];
function wp_parse_url(string $url, int $component = -1): mixed { return parse_url($url, $component); }
function wp_http_validate_url(string $url): string|false { return str_starts_with($url, 'https://example.test/') ? $url : false; }
function wp_remote_get(string $url, array $options = []): array {
    $GLOBALS['asset_requests'][] = ['url' => $url, 'options' => $options];
    [$type, $body, $code] = array_pad($GLOBALS['asset_fixtures'][$url] ?? ['text/plain', '', 404], 3, 200);
    return ['response' => ['code' => $code], 'body' => substr($body, 0, $options['limit_response_size'] ?? strlen($body)), 'headers' => ['content-type' => $type]];
}
function wp_remote_retrieve_response_code(array $response): int { return $response['response']['code'] ?? 0; }
function wp_remote_retrieve_body(array $response): string { return $response['body'] ?? ''; }
function wp_remote_retrieve_header(array $response, string $name): string { return $response['headers'][strtolower($name)] ?? ''; }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function sanitize_file_name(string $name): string { return preg_replace('~[^A-Za-z0-9._-]+~', '-', $name) ?: ''; }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function home_url(string $path = ''): string { return 'https://wordpress.test/' . ltrim($path, '/'); }
function get_temp_dir(): string { return sys_get_temp_dir() . '/'; }
function esc_url(string $value): string { return htmlspecialchars($value, ENT_QUOTES, 'UTF-8'); }
require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';
$reflection = new ReflectionClass(Kodety_Plugin::class);
$plugin = $reflection->newInstanceWithoutConstructor();
function asset_check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function import_call(string $name, mixed ...$arguments): mixed {
    global $reflection, $plugin;
    return $reflection->getMethod($name)->invokeArgs($plugin, $arguments);
}
function fetch_css(string $url, array &$budget): ?string {
    global $reflection, $plugin;
    return $reflection->getMethod('import_fetch_stylesheet')->invokeArgs($plugin, [$url, &$budget]);
}
function add_asset(string $path, string $type = 'image/webp', ?string $body = null): void {
    $GLOBALS['asset_fixtures']['https://example.test/' . ltrim($path, '/')] = [$type, $body ?? ('bytes:' . $path)];
}

$base = 'https://example.test/a/b/page.html?old=1';
foreach ([
    '?format=webp' => 'https://example.test/a/b/page.html?format=webp',
    '?format=webp#icon' => 'https://example.test/a/b/page.html?format=webp#icon',
    '../images/./hero.webp' => 'https://example.test/a/images/hero.webp',
    './folder/..' => 'https://example.test/a/b/',
    './folder/.' => 'https://example.test/a/b/folder/',
    '/cdn//asset.webp' => 'https://example.test/cdn//asset.webp',
    '../%2e%2e/asset.webp' => 'https://example.test/a/%2e%2e/asset.webp',
    '//example.test/cdn.webp' => 'https://example.test/cdn.webp',
    'image name.webp' => 'https://example.test/a/b/image%20name.webp',
    'blob:https://example.test/uuid' => 'blob:https://example.test/uuid',
    'about:blank' => 'about:blank',
    'urn:example:logo' => 'urn:example:logo',
    '#svg-fragment' => '#svg-fragment',
] as $input => $expected) {
    asset_check(import_call('import_absolutize_url', $input, $base) === $expected, 'URL resolution: ' . $input);
}

$srcset = 'data:image/svg+xml,%3Csvg,%3E 1x, ../cdn/image,w_960.webp 2x, ./large.webp 3x';
$mapped = import_call('import_absolutize_srcset', $srcset, $base);
asset_check($mapped === 'data:image/svg+xml,%3Csvg,%3E 1x, https://example.test/a/cdn/image,w_960.webp 2x, https://example.test/a/b/large.webp 3x', 'srcset must preserve commas inside data and CDN URLs');
asset_check(import_call('import_absolutize_srcset', 'one.webp, two.webp 2x', $base) === 'https://example.test/a/b/one.webp, https://example.test/a/b/two.webp 2x', 'descriptorless srcset candidates');

$css = <<<'CSS'
/* url("ignore-comment.webp") @import "ignore-comment.css"; */
.label::after { content: 'url("ignore-text.webp")'; }
.hero { background: URL("../photos/hero(large).webp"); mask: url(#icon); }
.escaped { background: url(../photos/hero\(small\).webp); cursor: url("../photos/quo\"te.webp"),auto; }
.inline { background: url("data:image/svg+xml,<svg viewBox='0 0 1 1'>(x)</svg>"); }
.responsive { background: image-set("small.webp" 1x type("image/webp"), "large.webp" 2x); }
@font-face { src: url("../fonts/My\20 Font.woff2") format("woff2"); }
CSS;
$rewritten = import_call('import_rewrite_css_urls', $css, 'https://example.test/site/css/main.css');
asset_check(str_contains($rewritten, 'url("https://example.test/site/photos/hero(large).webp")'), 'quoted CSS parentheses');
asset_check(str_contains($rewritten, 'url("https://example.test/site/photos/hero(small).webp")'), 'unquoted CSS escapes');
asset_check(str_contains($rewritten, 'url("https://example.test/site/photos/quo\\"te.webp")'), 'CSS escaped quotes');
asset_check(str_contains($rewritten, 'https://example.test/site/fonts/My%20Font.woff2'), 'CSS hex escape URL resolution');
asset_check(str_contains($rewritten, 'image-set("https://example.test/site/css/small.webp" 1x type("image/webp"), "https://example.test/site/css/large.webp" 2x)'), 'image-set string resources and MIME type');
asset_check(str_contains($rewritten, "content: 'url(\"ignore-text.webp\")'") && str_contains($rewritten, '/* url("ignore-comment.webp") @import "ignore-comment.css"; */'), 'CSS text/comments must stay byte-for-byte');
asset_check(str_contains($rewritten, 'url(#icon)') && str_contains($rewritten, 'url("data:image/svg+xml,<svg'), 'SVG fragments and data URLs must survive');
foreach (['url("data:image/png;base64,%s")', 'url(data:image/png;base64,%s)', 'image-set("data:image/png;base64,%s" 1x, "small.webp" 2x)'] as $large_image) {
    $large_css = '.x{background:' . sprintf($large_image, str_repeat('A', 1024 * 1024)) . '} .y{background:url("next.webp")}';
    $large_rewritten = import_call('import_rewrite_css_urls', $large_css, 'https://example.test/main.css');
    asset_check(str_contains($large_rewritten, 'url("https://example.test/next.webp")'), 'large inline images must not exhaust regex stack and skip subsequent resources');
}

add_asset('site/css/main.css', 'text/css', '@charset "UTF-8"; @import "nested/chunk.css" layer(theme) supports(display: grid) screen and (min-width: 600px); @import "nested/chunk.css" layer(overrides); .main{background:URL("../photos/hero(large).webp")}');
add_asset('site/css/nested/chunk.css', 'text/css', '@import "../main.css"; @font-face{font-family:Demo;src:url("../../fonts/My\\20 Font.woff2")} .nested{background:image-set("../../small.webp" 1x type("image/webp"), "../../large.webp" 2x)}');
$budget = ['count' => 0, 'bytes' => 0];
$expanded = fetch_css('https://example.test/site/css/main.css', $budget);
asset_check(is_string($expanded) && str_contains($expanded, '@layer theme {') && str_contains($expanded, '@supports (display: grid) {') && str_contains($expanded, '@media screen and (min-width: 600px) {'), 'modern CSS import grammar');
asset_check(str_contains($expanded, '@layer overrides {') && substr_count($expanded, '@font-face') === 2, 'repeated imports preserve separate cascade layers');
asset_check(!str_contains($expanded, '@import') && !str_contains($expanded, '@charset'), 'cyclic imports/encoding directives must not leak');
asset_check($budget['count'] === 2, 'CSS graph fetches each resource once');
asset_check(strpos($expanded, '@media screen') < strpos($expanded, '@supports (display: grid)') && strpos($expanded, '@supports (display: grid)') < strpos($expanded, '@layer theme'), 'layer ordering must be conditional on import supports/media');
$wrappers = import_call('import_css_import_wrappers', 'layer supports(selector(:is(.a,.b))) (width >= 600px)');
asset_check($wrappers === ['@layer', '@supports selector(:is(.a,.b))', '@media (width >= 600px)'], 'anonymous layer and selector supports condition');

add_asset('missing.css', 'text/html', '<html>Soft 404</html>');
$bad_budget = ['count' => 0, 'bytes' => 0];
asset_check(fetch_css('https://example.test/missing.css', $bad_budget) === null, 'HTML must not become CSS');
asset_check(fetch_css('https://example.test/missing.css', $bad_budget) === null && $bad_budget['count'] === 1, 'failed CSS URLs are cached');
add_asset('opaque.css', 'text/plain', "\xef\xbb\xbf <html>Soft 404</html>");
asset_check(fetch_css('https://example.test/opaque.css', $bad_budget) === null, 'sniff HTML even if declared text/plain');
add_asset('limited.css', 'text/css', 'a{}b{}');
$limited_budget = ['count' => 0, 'bytes' => 24 * MB_IN_BYTES - 3];
asset_check(fetch_css('https://example.test/limited.css', $limited_budget) === null, 'response-size sentinel rejects truncated CSS');
$fallback_budget = ['count' => 80, 'bytes' => 0];
$fallback = $reflection->getMethod('import_expand_css')->invokeArgs($plugin, ['@import "missing.css" layer(remote); .x{color:red}', 'https://example.test/', &$fallback_budget]);
$requested = [];
$localized_fallback = import_call('import_map_css_urls', $fallback, static function (string $url) use (&$requested): string { $requested[] = $url; return 'assets/broken.css'; });
asset_check($requested === [] && str_contains($localized_fallback, '@import url("https://example.test/missing.css") layer(remote);'), 'unresolved CSS imports must stay remote rather than packaging CSS without its dependency graph');
$mixed_budget = ['count' => 0, 'bytes' => 0];
$mixed = $reflection->getMethod('import_expand_css')->invokeArgs($plugin, ['@import "site/css/main.css"; @import "missing.css"; .x{color:red}', 'https://example.test/', &$mixed_budget]);
asset_check(str_starts_with($mixed, '@import url("https://example.test/site/css/main.css"); @import'), 'a failed sibling import must retain the valid import ordering of earlier stylesheets');
$late_budget = ['count' => 0, 'bytes' => 0];
$late = $reflection->getMethod('import_expand_css')->invokeArgs($plugin, ['.x{color:red} @import "site/css/main.css";', 'https://example.test/', &$late_budget]);
asset_check($late_budget['count'] === 0 && str_contains($late, '@import "site/css/main.css";'), 'late invalid imports must remain inactive');

add_asset('site/photos/hero(large).webp');
add_asset('site/fonts/My%20Font.woff2', 'font/woff2');
add_asset('site/small.webp');
add_asset('site/large.webp');
add_asset('site/lazy.webp');
add_asset('site/poster.jpg', 'image/jpeg');
add_asset('site/clip.mp4', 'video/mp4');
add_asset('site/clip.webm', 'video/webm');
add_asset('site/sprite.svg', 'image/svg+xml', '<svg><symbol id="mark"><path d="M0 0h1v1Z"/></symbol></svg>');
add_asset('site/manual.pdf', 'application/pdf');
add_asset('site/webflow.js', 'application/javascript', 'window.Webflow=window.Webflow||[];window.Webflow.push(function(){window.imported=true});');
$html = <<<'HTML'
<!doctype html><html data-wf-site="site"><head>
<base href="https://example.test/site/">
<link rel="stylesheet" href="css/main.css">
<link rel="preload" as="image" imagesrcset="small.webp 1x, large.webp 2x">
<style>.hero{background:IMAGE-SET("small.webp" 1x,"large.webp" 2x)}</style>
</head><body><main class="w-container">
<a href="contact?lang=pt#form">Contact</a>
<img src="small.webp" srcset="data:image/svg+xml,%3Csvg,%3E 1x, large.webp 2x" data-srcset="lazy.webp 2x">
<div class="w-background-video" data-poster-url="poster.jpg" data-video-urls="clip.mp4,clip.webm"><video poster="poster.jpg"><source src="clip.mp4" type="video/mp4"></video></div>
<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="sprite.svg#mark"></use></svg>
<object data="manual.pdf" type="application/pdf"></object>
<div style="background:URL('large.webp')">Editable content</div>
</main><script src="webflow.js" integrity="sha256-origin" crossorigin="anonymous"></script></body></html>
HTML;
$prepared = import_call('prepare_imported_html', $html, 'https://example.test/origin/page', 'webflow');
asset_check(!str_contains($prepared, '<base') && str_contains($prepared, 'https://example.test/site/contact?lang=pt#form'), 'base URL resolution with navigation preserved');
$archive = import_call('import_bundle_page_assets', $prepared, 'https://example.test/origin/page', 'webflow');
$zip = new ZipArchive();
asset_check($zip->open($archive) === true, 'import ZIP opens');
try {
    $output = $zip->getFromName('index.html');
    asset_check(is_string($output), 'ZIP has the editable index');
    $manifest = json_decode($zip->getFromName('.incode/url-import.json'), true);
    asset_check(($manifest['platform'] ?? '') === 'webflow' && ($manifest['runtime'] ?? '') === 'preserved', 'Webflow import metadata preserves runtime contract');
    asset_check(($manifest['unresolvedAssetUrls'] ?? []) === [], 'all fixture resources must localize');
    $dom = new DOMDocument();
    @$dom->loadHTML($output);
    $localized_references = [];
    $collect = static function (string $reference) use (&$localized_references): string {
        if (str_starts_with($reference, 'assets/imported/') || str_starts_with($reference, 'scripts/vendor/')) $localized_references[] = $reference;
        return $reference;
    };
    foreach ($dom->getElementsByTagName('*') as $node) {
        foreach (['src', 'poster', 'data-poster-url', 'data', 'xlink:href'] as $attribute) {
            if ($node->hasAttribute($attribute)) $collect($node->getAttribute($attribute));
        }
        foreach (['srcset', 'data-srcset', 'imagesrcset'] as $attribute) {
            if ($node->hasAttribute($attribute)) import_call('import_map_srcset', $node->getAttribute($attribute), $collect);
        }
        if ($node->hasAttribute('data-video-urls')) import_call('import_map_video_urls', $node->getAttribute('data-video-urls'), $collect);
        if ($node->hasAttribute('style')) import_call('import_map_css_urls', $node->getAttribute('style'), $collect);
        if ($node->tagName === 'style') import_call('import_map_css_urls', $node->textContent, $collect);
    }
    asset_check(count($localized_references) >= 20, 'ZIP covers CSS, image-set, fonts, media, srcset, preload, SVG, objects and runtime');
    foreach ($localized_references as $reference) {
        $path = explode('#', $reference)[0];
        asset_check($zip->locateName($path) !== false, 'every localized resource reference resolves inside ZIP: ' . $path);
    }
    asset_check(str_contains($output, 'data:image/svg+xml,%3Csvg,%3E 1x'), 'data srcset remains exact through HTML and ZIP');
    asset_check(str_contains($output, '#mark') && str_contains($output, '@supports (display: grid)'), 'SVG fragments and conditional CSS survive packaging');
    asset_check(!str_contains($output, 'integrity="sha256-origin"'), 'localized script must not retain origin integrity');
    $runtime = $manifest['localizedRuntimeFiles'][0] ?? '';
    asset_check($zip->getFromName($runtime) === $GLOBALS['asset_fixtures']['https://example.test/site/webflow.js'][1], 'Webflow runtime source stays byte-for-byte');
} finally { $zip->close(); unlink($archive); }

foreach (['import_download_asset' => 96, 'import_download_runtime' => 48] as $method => $megabytes) {
    $budget = ['count' => 0, 'bytes' => $megabytes * MB_IN_BYTES - 3];
    add_asset('truncated.bin', $method === 'import_download_asset' ? 'image/png' : 'application/javascript', '123456');
    $result = $reflection->getMethod($method)->invokeArgs($plugin, ['https://example.test/truncated.bin', &$budget]);
    asset_check($result === null, 'response-size sentinel rejects truncated ' . $method);
}
add_asset('fake.png', 'application/octet-stream', '<!doctype html><html>Not an image</html>');
$budget = ['count' => 0, 'bytes' => 0];
asset_check($reflection->getMethod('import_download_asset')->invokeArgs($plugin, ['https://example.test/fake.png', &$budget]) === null, 'HTML must never localize as an image');
echo "PASS: portable URL/Webflow asset import runtime\n";
