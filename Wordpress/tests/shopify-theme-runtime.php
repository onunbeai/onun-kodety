<?php

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
define('MB_IN_BYTES', 1024 * 1024);

function sanitize_file_name(string $value): string { return preg_replace('/[^A-Za-z0-9._-]/', '-', $value) ?: ''; }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function esc_html(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function esc_attr(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function wp_mkdir_p(string $path): bool { return is_dir($path) || mkdir($path, 0777, true); }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }

require_once dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

$root = sys_get_temp_dir() . '/kodety-shopify-theme-' . bin2hex(random_bytes(5));
$theme = $root . '/source';
$extracted = $root . '/extracted';
mkdir($theme . '/layout', 0777, true);
mkdir($theme . '/sections', 0777, true);
mkdir($theme . '/blocks', 0777, true);
mkdir($theme . '/assets', 0777, true);
mkdir($theme . '/config', 0777, true);
file_put_contents($theme . '/layout/theme.liquid', '<!doctype html><html><body>{{ content_for_layout }}</body></html>');
file_put_contents($theme . '/sections/main-product.liquid', '<section data-comparison="2 > 1" {{ block.shopify_attributes }} id="Product-{{ section.id }}" class="product{% if product.available %} is-available{% endif %}" data-product-id={{ product.id }}><h2>{{ section.settings.heading }}</h2><a href="{{ product.url }}"><img src="{{ product.featured_image | image_url: width: 1200 }}" alt="{{ product.title | escape }}"><h1>{{ product.title }}</h1></a>{% if product.available %}<button>Comprar</button>{% endif %}</section>{% schema %}{"name":"Product","settings":[{"type":"text","id":"heading","default":"Escolhas para viver melhor"}]}{% endschema %}');
file_put_contents($theme . '/assets/theme.css', 'section{padding:2rem}');
file_put_contents($theme . '/config/settings_schema.json', '[{"theme_name":"Tema de teste"}]');
$horizon_footer_source = implode("\n", [
    '{% doc %}INTERNAL HORIZON DOCUMENTATION MUST STAY HIDDEN{% enddoc %}',
    '{% comment %}INTERNAL LIQUID COMMENT MUST STAY HIDDEN{% endcomment %}',
    '{% capture internal_note %}INTERNAL CAPTURE MUST STAY HIDDEN{% endcapture %}',
    '<footer class="footer-content section--{{ section.settings.section_width }}" style="--footer-gap: {{ section.settings.gap }}px">',
    "{% content_for 'blocks' %}",
    '</footer>',
    '{% stylesheet %}.footer-content{display:grid;gap:var(--footer-gap);background:#171717;color:white}{% endstylesheet %}',
    '{% style %}.footer-content>*{min-width:0}{% endstyle %}',
    '{% javascript %}document.documentElement.dataset.themeLoaded="true";{% endjavascript %}',
    '{% schema %}{"name":"Footer","settings":[{"type":"select","id":"section_width","default":"page-width"},{"type":"range","id":"gap","default":8}],"blocks":[{"type":"text"}]}{% endschema %}',
]);
file_put_contents($theme . '/sections/footer.liquid', $horizon_footer_source);
file_put_contents(
    $theme . '/blocks/text.liquid',
    '<div class="footer-copy"><h2>{{ block.settings.text }}</h2></div>{% schema %}{"name":"Text","settings":[{"type":"richtext","id":"text","default":"<p>Conteúdo do rodapé</p>"}]}{% endschema %}'
);
file_put_contents(
    $theme . '/sections/footer-group.json',
    '/* Shopify generated file */' . "\n"
        . '{"type":"footer","sections":{"footer":{"type":"footer","settings":{"section_width":"full-width","gap":24},"blocks":{"about":{"type":"text","settings":{"text":"<p>Sobre a marca</p>"}}},"block_order":["about"]}},"order":["footer"]}'
);

$plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();
$prepare = new ReflectionMethod(Kodety_Plugin::class, 'prepare_shopify_theme_workspace');
$prepare->setAccessible(true);
if ($prepare->invoke($plugin, $theme) !== true) throw new RuntimeException('Shopify theme was not detected.');
if (!is_file($theme . '/index.html')) throw new RuntimeException('Editable Shopify preview was not created.');
if (!is_file($theme . '/.incode/shopify-theme.json')) throw new RuntimeException('Shopify maintenance metadata was not created.');
$preview = (string) file_get_contents($theme . '/index.html');
if (str_contains($preview, '__KODETY_LIQUID_')) throw new RuntimeException('Liquid variable source leaked into the visual preview.');
if (!str_contains($preview, 'Produto de exemplo')) throw new RuntimeException('Liquid product values were not projected as visual sample content.');
if (!str_contains($preview, 'Escolhas para viver melhor')) throw new RuntimeException('Section schema defaults were not projected into the visual preview.');
if (!str_contains($preview, 'data-kodety-liquid-attr-')) throw new RuntimeException('Liquid attributes were not bound reversibly in the visual preview.');
if (!str_contains($preview, '<!--KODETY_LIQUID:')) throw new RuntimeException('Liquid control flow was not tokenized for round-trip.');
$preview_document = new DOMDocument();
$previous_libxml_errors = libxml_use_internal_errors(true);
$preview_loaded = $preview_document->loadHTML($preview);
libxml_clear_errors();
libxml_use_internal_errors($previous_libxml_errors);
$preview_section = $preview_document->getElementsByTagName('section')->item(0);
if (!$preview_loaded || !$preview_section instanceof DOMElement) {
    throw new RuntimeException('Adversarial Liquid start tag no longer projects as one editable section.');
}
if ($preview_section->getAttribute('data-comparison') !== '2 > 1') {
    throw new RuntimeException('A quoted greater-than sign terminated the Liquid start tag early.');
}
if ($preview_section->getAttribute('data-product-id') === '' || str_contains($preview_section->getAttribute('data-product-id'), 'KODETY_LIQUID')) {
    throw new RuntimeException('An unquoted Liquid attribute was not projected to a visual value.');
}
$has_bare_output_binding = false;
$start_tag_binding_count = 0;
foreach ($preview_section->attributes as $attribute) {
    if (str_starts_with($attribute->name, 'data-kodety-liquid-output-attribute-')) $has_bare_output_binding = true;
    if (str_starts_with($attribute->name, 'data-kodety-liquid-attr-')) $start_tag_binding_count++;
}
if (!$has_bare_output_binding || $start_tag_binding_count < 3) {
    throw new RuntimeException('Bare, conditional or unquoted Liquid bindings detached from their start tag.');
}
$horizon_preview_path = $theme . '/shopify-preview/footer.html';
if (!is_file($horizon_preview_path)) throw new RuntimeException('Horizon section preview was not created.');
$horizon_preview = (string) file_get_contents($horizon_preview_path);
if (!preg_match('~<style data-kodety-shopify-stylesheet>[\s\S]*?\.footer-content\s*\{~', $horizon_preview)) {
    throw new RuntimeException('Shopify stylesheet blocks were not converted into real preview styles.');
}
if (preg_match('~<main[^>]*>\s*\.footer-content\s*\{~s', $horizon_preview)) {
    throw new RuntimeException('Shopify stylesheet source leaked into the canvas as visible text.');
}
if (!str_contains($horizon_preview, 'Sobre a marca') || !str_contains($horizon_preview, 'data-kodety-shopify-block=')) {
    throw new RuntimeException('Horizon content_for blocks did not project configured Theme Block content.');
}
if (!str_contains($horizon_preview, 'section--full-width') || !str_contains($horizon_preview, '--footer-gap: 24px')) {
    throw new RuntimeException('Horizon section instance settings were not projected into the visual preview.');
}
if (!str_contains($horizon_preview, '<style data-kodety-shopify-style>.footer-content>*')) {
    throw new RuntimeException('Shopify style blocks were not converted into real preview styles.');
}
if (
    str_contains($horizon_preview, 'document.documentElement')
    || str_contains($horizon_preview, 'themeLoaded')
    || str_contains($horizon_preview, 'INTERNAL HORIZON DOCUMENTATION')
    || str_contains($horizon_preview, 'INTERNAL LIQUID COMMENT')
    || str_contains($horizon_preview, 'INTERNAL CAPTURE')
) {
    throw new RuntimeException('Shopify javascript, documentation, comments and captures must remain inert in the visual preview.');
}
$metadata = json_decode((string) file_get_contents($theme . '/.incode/shopify-theme.json'), true);
if (($metadata['kind'] ?? '') !== 'shopify-theme' || empty($metadata['previewSources']['index.html']['tokens']) || empty($metadata['previewSources']['index.html']['attributeBindings'])) {
    throw new RuntimeException('Shopify preview manifest is invalid.');
}
$project_metadata = json_decode((string) file_get_contents($theme . '/.incode/project.json'), true);
if (str_contains((string) ($project_metadata['name'] ?? ''), 'manutenção Shopify')) {
    throw new RuntimeException('Liquid projects must use the normal Builder project identity.');
}
$source_digest = (string) ($metadata['previewSources']['index.html']['sourceDigest'] ?? '');
if (!preg_match('/^[0-9a-f]{8}$/', $source_digest)) {
    throw new RuntimeException('Original Liquid fingerprint is missing from the maintenance manifest.');
}

// Autosave must preserve the exact Builder preview and token map. Recreating
// them here would silently discard visual edits before the normal export.
$edited_preview = str_replace('<h1>', '<h1 data-builder-edit="true">', $preview);
file_put_contents($theme . '/index.html', $edited_preview);
if ($prepare->invoke($plugin, $theme) !== true) throw new RuntimeException('Prepared Shopify workspace was not recognized.');
if ((string) file_get_contents($theme . '/index.html') !== $edited_preview) {
    throw new RuntimeException('Shopify autosave regenerated and discarded the edited preview.');
}
if ((string) file_get_contents($theme . '/layout/theme.liquid') === '') {
    throw new RuntimeException('Shopify autosave discarded layout/theme.liquid.');
}

$zip_path = $root . '/theme.zip';
$zip = new ZipArchive();
if ($zip->open($zip_path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) throw new RuntimeException('Could not create fixture ZIP.');
$zip->addFromString('layout/theme.liquid', '<html>{{ content_for_layout }}</html>');
$zip->addFromString('sections/main-product.liquid', '<section>{{ product.title }}</section>');
$zip->close();
mkdir($extracted, 0777, true);
$extract = new ReflectionMethod(Kodety_Plugin::class, 'extract_safe_zip');
$extract->setAccessible(true);
$extract->invoke($plugin, $zip_path, $extracted);
if (!is_file($extracted . '/layout/theme.liquid')) throw new RuntimeException('Secure importer discarded theme.liquid.');

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

echo "Shopify theme maintenance runtime checks passed.\n";
