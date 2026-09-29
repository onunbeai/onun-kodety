<?php
defined('ABSPATH') || exit;

/** Runtime location is normally the active generated theme. In Agency mode
 * the plugin supplies a request-scoped publication instead. */
function kodety_runtime_context(): array {
    $context = function_exists('apply_filters')
        ? apply_filters('kodety_runtime_context', [])
        : [];
    return is_array($context) ? $context : [];
}

function kodety_runtime_directory(): string {
    $context = kodety_runtime_context();
    $directory = (string) ($context['directory'] ?? '');
    return $directory !== '' ? untrailingslashit($directory) : get_template_directory();
}

function kodety_runtime_directory_uri(): string {
    $context = kodety_runtime_context();
    $uri = (string) ($context['directoryUri'] ?? '');
    return $uri !== '' ? untrailingslashit($uri) : get_template_directory_uri();
}

function kodety_runtime_public_url(string $path = ''): string {
    $context = kodety_runtime_context();
    $base = (string) ($context['baseUrl'] ?? '');
    if ($base === '') return home_url('/' . ltrim($path, '/'));
    return trailingslashit($base) . ltrim($path, '/');
}

/** Map only srcset URL spans; commas inside data/CDN URLs are not separators. */
function kodety_runtime_map_srcset(string $value, callable $map): string {
    $length = strlen($value);
    $position = 0;
    $copied = 0;
    $result = '';
    while ($position < $length) {
        $position += strspn($value, " \t\r\n\f,", $position);
        if ($position >= $length) break;
        $start = $position;
        $position += strcspn($value, " \t\r\n\f", $position);
        $end = $position;
        while ($end > $start && $value[$end - 1] === ',') $end--;
        if ($end === $start) continue;
        $url = substr($value, $start, $end - $start);
        $mapped = (string) $map($url);
        if ($mapped !== $url) {
            $result .= substr($value, $copied, $start - $copied) . $mapped;
            $copied = $end;
        }
        if ($end < $position) continue;
        $parentheses = 0;
        while ($position < $length) {
            $character = $value[$position++];
            if ($character === '(') $parentheses++;
            elseif ($character === ')' && $parentheses > 0) $parentheses--;
            elseif ($character === ',' && $parentheses === 0) break;
        }
    }
    return $result . substr($value, $copied);
}

function kodety_runtime_release(): string {
    $context = kodety_runtime_context();
    $release = trim((string) ($context['release'] ?? ''));
    if (preg_match('/^[A-Za-z0-9_-]{1,96}$/', $release)) return $release;
    $current = trim((string) get_option('kodety_current_release', ''));
    return preg_match('/^[A-Za-z0-9_-]{1,96}$/', $current) ? $current : '';
}

function kodety_project_cms_option(string $name, mixed $default = []): mixed {
    if (class_exists('Kodety_Plugin') && function_exists('wp_upload_dir')) {
        return Kodety_Plugin::instance()->project_cms_option($name, $default);
    }
    return get_option($name, $default);
}

if (is_file(__DIR__ . '/performance.php')) {
    require_once __DIR__ . '/performance.php';
    add_filter('template_include', [Kodety_Public_HTML_Compression::class, 'start'], PHP_INT_MAX);
}
if (is_file(__DIR__ . '/redirects.php')) require_once __DIR__ . '/redirects.php';
if (
    is_file(__DIR__ . '/membership.php')
    && function_exists('apply_filters')
    && (bool) apply_filters('kodety_membership_runtime_enabled', false)
) require_once __DIR__ . '/membership.php';
add_action('after_setup_theme', function (): void {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
});

function kodety_seo_runtime_settings(): array {
    static $settings = null;
    if (is_array($settings)) return $settings;
    $path = kodety_runtime_directory() . '/seo.json';
    $candidate = is_file($path) && !is_link($path)
        ? json_decode((string) file_get_contents($path), true)
        : [];
    $settings = array_merge([
        'version' => 1,
        'sitemapEnabled' => true,
        'blockAiTrainingBots' => false,
        'robotsTxtRules' => '',
        'excludedPaths' => [],
    ], is_array($candidate) ? $candidate : []);
    return $settings;
}

add_filter('robots_txt', static function (string $output, bool $public): string {
    $settings = kodety_seo_runtime_settings();
    $blocks = [];
    if (($settings['blockAiTrainingBots'] ?? false) === true) {
        foreach (['GPTBot', 'Google-Extended', 'CCBot', 'ClaudeBot', 'anthropic-ai'] as $agent) {
            $blocks[] = "User-agent: {$agent}\nDisallow: /";
        }
    }
    $rules = trim((string) ($settings['robotsTxtRules'] ?? ''));
    if ($rules !== '') $blocks[] = $rules;
    // Kodety_Sitemap owns discovery for generated inventories. Legacy releases
    // retain WordPress discovery until their next publication.
    if (!class_exists('Kodety_Sitemap') && ($settings['sitemapEnabled'] ?? true) !== false) $blocks[] = 'Sitemap: ' . esc_url_raw(home_url('/wp-sitemap.xml'));
    return rtrim($output) . ($blocks ? "\n\n" . implode("\n\n", $blocks) : '') . "\n";
}, 20, 2);

add_filter('wp_sitemaps_enabled', static fn(bool $enabled): bool =>
    // Preserve genuine WordPress content on hybrid sites. Onun Kodety exclusions
    // are applied separately to native post queries.
    $enabled && (class_exists('Kodety_Sitemap') || (kodety_seo_runtime_settings()['sitemapEnabled'] ?? true) !== false)
);

add_filter('wp_sitemaps_posts_query_args', static function (array $args, string $post_type): array {
    $excluded_paths = array_values(array_filter(
        (array) (kodety_seo_runtime_settings()['excludedPaths'] ?? []),
        static fn(mixed $path): bool => is_string($path) && $path !== ''
    ));
    if (!$excluded_paths) return $args;
    $templates = kodety_project_cms_option('kodety_cms_templates', []);
    if (is_array($templates) && isset($templates[$post_type]) && in_array((string) $templates[$post_type], $excluded_paths, true)) {
        $args['post__in'] = [0];
        return $args;
    }
    if ($post_type !== 'page') return $args;
    global $wpdb;
    $placeholders = implode(',', array_fill(0, count($excluded_paths), '%s'));
    $sql = $wpdb->prepare(
        "SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = '_kodety_html_path' AND meta_value IN ({$placeholders})",
        ...$excluded_paths
    );
    $ids = array_map('intval', (array) $wpdb->get_col($sql));
    if ($ids) $args['post__not_in'] = array_values(array_unique(array_merge((array) ($args['post__not_in'] ?? []), $ids)));
    return $args;
}, 10, 2);

function kodety_cms_item_permalink(WP_Post $post): string {
    $base = '';
    foreach ((array) kodety_project_cms_option('kodety_collections', []) as $definition) {
        if (($definition['slug'] ?? '') !== $post->post_type) continue;
        $base = sanitize_title((string) ($definition['urlSlug'] ?? $definition['name'] ?? $post->post_type));
        break;
    }
    if ($base === '') {
        $object = get_post_type_object($post->post_type);
        if ($post->post_type === 'post') $base = sanitize_title((string) ($object?->labels->name ?: 'posts'));
        elseif (is_array($object?->rewrite) && !empty($object->rewrite['slug'])) $base = sanitize_title((string) $object->rewrite['slug']);
        else $base = sanitize_title($post->post_type);
    }
    $slug = sanitize_title($post->post_name ?: (string) $post->ID);
    $permalink = kodety_runtime_public_url(user_trailingslashit(trim($base . '/' . $slug, '/')));
    return (string) apply_filters('kodety_cms_item_permalink', $permalink, $post);
}

/** Resolve a Onun Kodety binding against one WordPress content item. */
function kodety_cms_value(WP_Post $post, string $binding): mixed {
    if (str_starts_with($binding, 'field:')) {
        $key = sanitize_key(substr($binding, 6));
        if ($key === '') return '';
        return function_exists('get_field') ? get_field($key, $post->ID) : get_post_meta($post->ID, $key, true);
    }
    $standard = match ($binding) {
        'title' => get_the_title($post),
        'excerpt' => get_the_excerpt($post),
        'content' => apply_filters('the_content', $post->post_content),
        'featured_image' => (string) get_the_post_thumbnail_url($post, 'full'),
        'featured_image_alt' => ($thumbnail_id = get_post_thumbnail_id($post)) ? (string) get_post_meta($thumbnail_id, '_wp_attachment_image_alt', true) : '',
        'permalink' => kodety_cms_item_permalink($post),
        'date' => get_the_date('', $post),
        'author' => get_the_author_meta('display_name', (int) $post->post_author),
        'slug' => $post->post_name,
        default => null,
    };
    if ($standard !== null) return $standard;
    // Settings inserts collection keys as {{price}}, {{location}}, etc. Keep
    // the explicit field: form compatible while resolving these friendlier
    // expressions against native meta/ACF as well.
    $key = sanitize_key($binding);
    if ($key === '') return '';
    return function_exists('get_field') ? get_field($key, $post->ID) : get_post_meta($post->ID, $key, true);
}

function kodety_cms_scalar_value(mixed $value): string {
    if (is_array($value)) {
        if (isset($value['url'])) return (string) $value['url'];
        if (isset($value['value'])) return (string) $value['value'];
        return implode(', ', array_map('kodety_cms_scalar_value', $value));
    }
    if ($value instanceof WP_Post) return get_the_title($value);
    return is_scalar($value) ? (string) $value : '';
}

/** Keep filter payloads small and JSON-safe. Only fields explicitly connected
 * in the authored filter form are exposed on the corresponding rendered item. */
function kodety_cms_filter_value(mixed $value): mixed {
    if ($value instanceof WP_Post) return get_the_title($value);
    if (is_object($value)) return method_exists($value, '__toString') ? (string) $value : '';
    if (!is_array($value)) return is_scalar($value) || $value === null ? $value : '';
    $normalized = [];
    foreach ($value as $key => $child) $normalized[$key] = kodety_cms_filter_value($child);
    return $normalized;
}

/** @param list<string> $fields */
function kodety_cms_filter_payload(WP_Post $post, array $fields): array {
    $payload = [];
    foreach ($fields as $field) {
        if (!preg_match('/^(?:title|excerpt|content|slug|permalink|date|author|field:[a-z0-9_-]+)$/', $field)) continue;
        $payload[$field] = kodety_cms_filter_value(kodety_cms_value($post, $field));
    }
    return $payload;
}

/** Resolve visual Settings expressions such as "{{title}} · Brand" against
 * the singular CMS item. Kept separate from element bindings because head
 * metadata uses text nodes, attributes and JSON-LD. */
function kodety_cms_resolve_template(WP_Post $post, string $template): string {
    return (string) preg_replace_callback('/\{\{([^{}]+)\}\}/', static function (array $match) use ($post): string {
        $binding = sanitize_text_field(trim((string) ($match[1] ?? '')));
        return $binding === '' ? '' : kodety_cms_scalar_value(kodety_cms_value($post, $binding));
    }, $template);
}

function kodety_cms_resolve_seo_head(DOMDocument $document, WP_Post $post): void {
    $xpath = new DOMXPath($document);
    foreach ($xpath->query('//title') ?: [] as $node) {
        if ($node instanceof DOMElement && str_contains($node->textContent, '{{')) $node->textContent = kodety_cms_resolve_template($post, $node->textContent);
    }
    foreach ($xpath->query('//meta[@content] | //link[@href]') ?: [] as $node) {
        if (!$node instanceof DOMElement) continue;
        $attribute = strtolower($node->tagName) === 'meta' ? 'content' : 'href';
        $value = $node->getAttribute($attribute);
        if (str_contains($value, '{{')) $node->setAttribute($attribute, kodety_cms_resolve_template($post, $value));
    }
    foreach ($xpath->query('//script[@data-kodety-seo]') ?: [] as $node) {
        if (!$node instanceof DOMElement || !str_contains($node->textContent, '{{')) continue;
        $schema = json_decode($node->textContent, true);
        if (!is_array($schema)) continue;
        $resolve = function (mixed $value) use (&$resolve, $post): mixed {
            if (is_string($value)) return kodety_cms_resolve_template($post, $value);
            if (!is_array($value)) return $value;
            foreach ($value as $key => $child) $value[$key] = $resolve($child);
            return $value;
        };
        $node->textContent = (string) wp_json_encode($resolve($schema), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}

/** Replace a node's children with parsed HTML. appendXML() rejects real-world
 *  HTML (unclosed tags, named entities), so parse through a helper document. */
function kodety_cms_set_html_content(DOMElement $node, string $html): void {
    while ($node->firstChild) $node->removeChild($node->firstChild);
    if ($html === '') return;
    $helper = new DOMDocument('1.0', 'UTF-8');
    $internal_errors = libxml_use_internal_errors(true);
    $loaded = $helper->loadHTML(
        '<?xml encoding="utf-8" ?><div data-kodety-cms-fragment="1">' . $html . '</div>',
        LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
    );
    libxml_clear_errors();
    libxml_use_internal_errors($internal_errors);
    $wrapper = null;
    if ($loaded) {
        foreach ((new DOMXPath($helper))->query('//div[@data-kodety-cms-fragment]') ?: [] as $candidate) {
            if ($candidate instanceof DOMElement) { $wrapper = $candidate; break; }
        }
    }
    if (!$wrapper instanceof DOMElement) {
        $node->appendChild($node->ownerDocument->createTextNode(wp_strip_all_tags($html)));
        return;
    }
    foreach (iterator_to_array($wrapper->childNodes) as $child) {
        $imported = $node->ownerDocument->importNode($child, true);
        if ($imported) $node->appendChild($imported);
    }
}

/** A repeated CMS item owns its binding context. Singular page data must never
 * leak into it after the collection renderer has populated the clone. */
function kodety_cms_has_isolated_item_context(DOMElement $node): bool {
    for ($current = $node; $current instanceof DOMElement; $current = $current->parentNode) {
        if (
            $current->hasAttribute('data-kodety-collection')
            || $current->hasAttribute('data-kodety-rendered-collection')
            || $current->hasAttribute('data-kodety-item-id')
        ) return true;
    }
    return false;
}

/** True when $node is owned by a collection nested inside $root. */
function kodety_cms_is_in_nested_collection(DOMElement $node, DOMElement $root): bool {
    for ($current = $node; $current instanceof DOMElement && !$current->isSameNode($root); $current = $current->parentNode) {
        if ($current->hasAttribute('data-kodety-collection')) return true;
    }
    return false;
}

/** Apply element bindings to a root node and all of its descendants. */
function kodety_apply_cms_bindings(
    DOMElement $root,
    WP_Post $post,
    bool $skip_collection_items = false,
    bool $skip_nested_collections = false
): void {
    $nodes = [$root];
    $binding_query = './/*[@data-kodety-bind or @data-kodety-bind-content or @data-kodety-bind-title or @data-kodety-bind-href or @data-kodety-bind-src or @data-kodety-bind-alt]';
    foreach ((new DOMXPath($root->ownerDocument))->query($binding_query, $root) ?: [] as $node) {
        if ($node instanceof DOMElement) $nodes[] = $node;
    }
    foreach ($nodes as $node) {
        if ($skip_collection_items && kodety_cms_has_isolated_item_context($node)) continue;
        if ($skip_nested_collections && kodety_cms_is_in_nested_collection($node, $root)) continue;
        $bindings = [];
        if ($node->hasAttribute('data-kodety-bind')) {
            $legacy_target = sanitize_key($node->getAttribute('data-kodety-bind-target'));
            if ($legacy_target === '' || $legacy_target === 'auto') {
                $legacy_target = match (strtolower($node->tagName)) { 'a' => 'href', 'img', 'source', 'video' => 'src', default => 'content' };
            }
            $bindings[$legacy_target] = sanitize_text_field($node->getAttribute('data-kodety-bind'));
        }
        foreach (['content', 'title', 'href', 'src', 'alt'] as $target) {
            $attribute = 'data-kodety-bind-' . $target;
            if ($node->hasAttribute($attribute)) $bindings[$target] = sanitize_text_field($node->getAttribute($attribute));
        }
        foreach ($bindings as $target => $binding) {
            if ($binding === '') continue;
            $value = kodety_cms_value($post, $binding);
            if ($target === 'content') {
                $html_value = $binding === 'content' || (is_string($value) && str_contains($value, '<'));
                if ($html_value && is_string($value)) {
                    kodety_cms_set_html_content($node, $value);
                } else {
                    while ($node->firstChild) $node->removeChild($node->firstChild);
                    $node->appendChild($node->ownerDocument->createTextNode(kodety_cms_scalar_value($value)));
                }
                continue;
            }
            if ($target === 'href' && $binding === 'slug') $value = kodety_cms_item_permalink($post);
            if ($target === 'href' && $value instanceof WP_Post) $value = kodety_cms_item_permalink($value);
            if ($target === 'src' && is_numeric($value) && wp_attachment_is_image(absint($value))) {
                $value = (string) (wp_get_attachment_image_url(absint($value), 'full') ?: '');
            }
            if ($target === 'alt' && is_array($value) && isset($value['alt'])) $value = (string) $value['alt'];
            if ($target === 'src' && is_array($value)) {
                $focal_x = max(0, min(100, (float) ($value['focalX'] ?? 50)));
                $focal_y = max(0, min(100, (float) ($value['focalY'] ?? 50)));
                $existing_style = trim($node->getAttribute('style'));
                $crop_style = match (sanitize_key((string) ($value['crop'] ?? 'original'))) {
                    'square' => 'aspect-ratio:1/1;object-fit:cover;',
                    'landscape' => 'aspect-ratio:16/9;object-fit:cover;',
                    'portrait' => 'aspect-ratio:4/5;object-fit:cover;',
                    default => '',
                };
                $node->setAttribute('style', rtrim($existing_style, ';') . ($existing_style !== '' ? ';' : '') . 'object-position:' . $focal_x . '% ' . $focal_y . '%;' . $crop_style);
            }
            $scalar = kodety_cms_scalar_value($value);
            if ($scalar !== '') $node->setAttribute($target, $scalar); else $node->removeAttribute($target);
            if ($target === 'src') $node->removeAttribute('srcset');
        }
    }
}

/** True when the nearest collection ancestor of $node is $container itself. */
function kodety_cms_belongs_to_collection(DOMElement $node, DOMElement $container): bool {
    for ($ancestor = $node->parentNode; $ancestor instanceof DOMElement; $ancestor = $ancestor->parentNode) {
        if ($ancestor->isSameNode($container)) return true;
        if ($ancestor->hasAttribute('data-kodety-collection')) return false;
    }
    return false;
}

function kodety_cms_strip_empty_states(DOMElement $root, bool $skip_nested_collections = false): void {
    $nodes = [];
    foreach ((new DOMXPath($root->ownerDocument))->query('.//*[@data-kodety-empty-state]', $root) ?: [] as $node) {
        if ($node instanceof DOMElement) $nodes[] = $node;
    }
    foreach ($nodes as $node) {
        if ($skip_nested_collections && kodety_cms_is_in_nested_collection($node, $root)) continue;
        $node->parentNode?->removeChild($node);
    }
}

function kodety_cms_has_empty_state(DOMElement $root): bool {
    foreach ((new DOMXPath($root->ownerDocument))->query('.//*[@data-kodety-empty-state]', $root) ?: [] as $node) {
        if ($node instanceof DOMElement && !kodety_cms_is_in_nested_collection($node, $root)) return true;
    }
    return false;
}

/**
 * Normalize markup after DOMDocument serializes a published page.
 *
 * DOMDocument turns the UTF-8 hint used while parsing into either an XML
 * processing instruction or an HTML comment, and entity-encodes the middle
 * dot inside comments. Neither representation should leak into the response.
 */
function kodety_cleanup_runtime_html(string $html): string {
    $html = (string) preg_replace(
        '/(?:<\?xml\s+encoding=["\']utf-8["\']\s*\?>|<!--\s*\?xml\s+encoding=["\']utf-8["\']\s*\?\s*-->)/i',
        '',
        $html
    );
    $html = (string) preg_replace(
        '/<!--\s*Made\s+with\s+(?:Onun\s+)?Kodety(?:\s+for\s+WordPress)?\s*(?:(?:·|&middot;|&#0*183;|&#x0*b7;)?\s*(?:unkern|kodety)\.com)?\s*-->/i',
        '<!-- Made with Onun Kodety for WordPress -->',
        $html
    );
    return $html;
}

/**
 * Serialize a DOMDocument without letting libxml entity-encode JavaScript or
 * CSS raw-text payloads. Entity references are not decoded inside <script> or
 * <style> by browsers, so a normal saveHTML() turns UTF-8 values such as
 * "começa" into the visible string "come&ccedil;a" at runtime. Temporarily
 * replacing each payload also preserves intentionally authored strings such
 * as "&amp;" byte-for-byte.
 */
function kodety_save_runtime_html(DOMDocument $document): string|false {
    $raw_text = [];
    try {
        $nonce = bin2hex(random_bytes(16));
    } catch (Throwable) {
        $nonce = hash('sha256', uniqid('kodety-raw-text-', true));
    }
    $nodes = iterator_to_array((new DOMXPath($document))->query('//script | //style') ?: []);
    foreach ($nodes as $index => $node) {
        if (!$node instanceof DOMElement) continue;
        $payload = $node->textContent;
        $token = '__KODETY_RAW_TEXT_' . $nonce . '_' . $index . '__';
        while (str_contains($payload, $token)) $token .= '_';
        $raw_text[$token] = $payload;
        while ($node->firstChild) $node->removeChild($node->firstChild);
        $node->appendChild($document->createTextNode($token));
    }
    $html = $document->saveHTML();
    return is_string($html) && $raw_text ? strtr($html, $raw_text) : $html;
}

/**
 * Keep editor-materialized Custom Code opaque while CMS, localization and
 * WordPress URL transforms operate on the surrounding authored document.
 *
 * @return array{0:string,1:array<string,string>}
 */
function kodety_protect_runtime_custom_code_blocks(string $html): array {
    if (!str_contains($html, 'kodety-custom-code:start')) return [$html, []];
    try {
        $nonce = bin2hex(random_bytes(16));
    } catch (Throwable) {
        $nonce = hash('sha256', uniqid('kodety-runtime-custom-code-', true));
    }
    $source = $html;
    $blocks = [];
    $protected = preg_replace_callback(
        '~<!--\s*kodety-custom-code:start\s+([^\s]+)\s*-->([\s\S]*?)<!--\s*kodety-custom-code:end\s+\1\s*-->~iu',
        static function (array $match) use (&$blocks, $nonce, $source): string {
            $token = '__KODETY_RUNTIME_CUSTOM_CODE_' . $nonce . '_' . count($blocks) . '__';
            while (str_contains($source, $token) || isset($blocks[$token])) $token .= '_';
            $blocks[$token] = $match[0];
            return '<template data-kdy-custom-code-placeholder="' . $token . '"></template>';
        },
        $html
    );
    return [is_string($protected) ? $protected : $html, $blocks];
}

/** @param array<string,string> $blocks */
function kodety_restore_runtime_custom_code_blocks(string $html, array $blocks): string {
    foreach ($blocks as $token => $block) {
        $quoted = preg_quote($token, '~');
        $restored = preg_replace_callback(
            '~<template\b(?=[^>]*\bdata-kdy-custom-code-placeholder=(["\'])' . $quoted . '\1)[^>]*(?:>\s*</template\s*>|/>)~i',
            static fn(): string => $block,
            $html,
            1
        );
        if (is_string($restored)) $html = $restored;
    }
    return $html;
}

/**
 * Shield HTML raw-text/RCDATA payloads from broad attribute URL rewrites while
 * still allowing real attributes on their opening tags to be normalized.
 *
 * @return array{0:string,1:array<string,string>}
 */
function kodety_protect_runtime_raw_text_payloads(
    string $html,
    bool $leave_kodety_seo_scripts_visible = false,
    bool $protect_document_text = false
): array {
    $elements = $protect_document_text
        ? 'script|style|title|textarea|xmp|iframe|noembed|noframes|noscript'
        : 'script|style';
    if (!preg_match(
        '~<(?:' . $elements . ')(?=[\s/>])~i',
        $html
    )) return [$html, []];
    try {
        $nonce = bin2hex(random_bytes(16));
    } catch (Throwable) {
        $nonce = hash('sha256', uniqid('kodety-runtime-raw-text-', true));
    }
    $source = $html;
    $payloads = [];
    $protected = preg_replace_callback(
        '~(<(' . $elements . ')(?=[\s/>])[^>]*>)([\s\S]*?)(</\2\s*>)~i',
        static function (array $match) use (
            &$payloads,
            $nonce,
            $source,
            $leave_kodety_seo_scripts_visible
        ): string {
            if (
                $leave_kodety_seo_scripts_visible
                && strtolower($match[2]) === 'script'
                && preg_match('~\bdata-kodety-seo(?:\s*=|\s|>)~i', $match[1])
            ) {
                return $match[0];
            }
            $token = '__KODETY_RUNTIME_RAW_TEXT_' . $nonce . '_' . count($payloads) . '__';
            while (str_contains($source, $token) || isset($payloads[$token])) $token .= '_';
            $payloads[$token] = $match[3];
            return $match[1] . $token . $match[4];
        },
        $html
    );
    return [is_string($protected) ? $protected : $html, $payloads];
}

/** @param array<string,string> $payloads */
function kodety_restore_runtime_raw_text_payloads(string $html, array $payloads): string {
    return $payloads ? strtr($html, $payloads) : $html;
}

/** @return array<string,array{value:?string,valueOffset:int,valueLength:int,quote:string}> */
function kodety_runtime_tag_attributes(string $tag): array {
    $attributes = [];
    $length = strlen($tag);
    $offset = strpos($tag, '<');
    if ($offset === false) return [];
    $offset++;
    while ($offset < $length && str_contains(" \t\r\n\f", $tag[$offset])) $offset++;
    while (
        $offset < $length
        && !str_contains(" \t\r\n\f/>", $tag[$offset])
    ) $offset++;

    while ($offset < $length) {
        while ($offset < $length && str_contains(" \t\r\n\f", $tag[$offset])) $offset++;
        if ($offset >= $length || $tag[$offset] === '>') break;
        if ($tag[$offset] === '/' && ($tag[$offset + 1] ?? '') === '>') break;

        $name_offset = $offset;
        while (
            $offset < $length
            && !str_contains(" \t\r\n\f=/>\"'", $tag[$offset])
        ) $offset++;
        if ($offset === $name_offset) {
            $offset++;
            continue;
        }
        $name = strtolower(substr($tag, $name_offset, $offset - $name_offset));
        while ($offset < $length && str_contains(" \t\r\n\f", $tag[$offset])) $offset++;

        $value = null;
        $value_offset = $offset;
        $value_length = 0;
        $quote = '';
        if (($tag[$offset] ?? '') === '=') {
            $offset++;
            while ($offset < $length && str_contains(" \t\r\n\f", $tag[$offset])) $offset++;
            $quote = ($tag[$offset] ?? '') === '"' || ($tag[$offset] ?? '') === "'"
                ? $tag[$offset++]
                : '';
            $value_offset = $offset;
            if ($quote !== '') {
                while ($offset < $length && $tag[$offset] !== $quote) $offset++;
            } else {
                while (
                    $offset < $length
                    && !str_contains(" \t\r\n\f>", $tag[$offset])
                ) $offset++;
            }
            $value_length = $offset - $value_offset;
            $value = substr($tag, $value_offset, $value_length);
            if ($quote !== '' && ($tag[$offset] ?? '') === $quote) $offset++;
        }
        if (!array_key_exists($name, $attributes)) {
            $attributes[$name] = [
                'value' => $value,
                'valueOffset' => $value_offset,
                'valueLength' => $value_length,
                'quote' => $quote,
            ];
        }
    }
    return $attributes;
}

function kodety_runtime_tag_attribute_value(string $tag, string $attribute): ?string {
    $parsed = kodety_runtime_tag_attributes($tag)[strtolower($attribute)] ?? null;
    if (!is_array($parsed) || !is_string($parsed['value'])) return null;
    return html_entity_decode(
        $parsed['value'],
        ENT_QUOTES | ENT_HTML5,
        'UTF-8'
    );
}

function kodety_runtime_tag_has_attribute(string $tag, string $attribute): bool {
    return array_key_exists(strtolower($attribute), kodety_runtime_tag_attributes($tag));
}

function kodety_runtime_tag_end_offset(string $html, int $start): ?int {
    $length = strlen($html);
    $quote = '';
    for ($offset = max(0, $start + 1); $offset < $length; $offset++) {
        $character = $html[$offset];
        if ($quote !== '') {
            if ($character === $quote) $quote = '';
            continue;
        }
        if ($character === '"' || $character === "'") {
            $quote = $character;
            continue;
        }
        if ($character === '>') return $offset;
    }
    return null;
}

/**
 * Add the current public release to one relative/root-relative asset URL.
 *
 * `kodety-release` is reserved by the runtime so a second render replaces the
 * previous value instead of accumulating cache-busting parameters. Absolute
 * and protocol-relative URLs belong to another cache contract and stay
 * untouched.
 */
function kodety_runtime_version_local_asset_url(string $url, string $release): string {
    $release = trim($release);
    if ($release === '' || !preg_match('/^[A-Za-z0-9_-]{1,96}$/', $release)) return $url;

    $original = $url;
    if (!preg_match('/^(\s*)(.*?)(\s*)$/s', $url, $parts)) return $original;
    $prefix = (string) ($parts[1] ?? '');
    $url = (string) ($parts[2] ?? '');
    $suffix = (string) ($parts[3] ?? '');
    if ($url === '' || str_starts_with($url, '#') || str_starts_with($url, '//')) return $original;
    $scheme_probe = (string) preg_replace('/[\x00-\x20\x7f]+/', '', $url);
    if (preg_match('~^[a-z][a-z0-9+.-]*:~i', $scheme_probe)) return $original;

    $fragment = '';
    $fragment_offset = strpos($url, '#');
    if ($fragment_offset !== false) {
        $fragment = substr($url, $fragment_offset);
        $url = substr($url, 0, $fragment_offset);
    }

    $query_offset = strpos($url, '?');
    $path = $query_offset === false ? $url : substr($url, 0, $query_offset);
    if ($path === '') return $original;

    $parameter = 'kodety-release=' . rawurlencode($release);
    if ($query_offset === false) return $prefix . $url . '?' . $parameter . $fragment . $suffix;

    $query = substr($url, $query_offset + 1);
    if (preg_match('/(^|&)kodety-release(?:=[^&]*)?(?=&|$)/i', $query)) {
        $query = (string) preg_replace_callback(
            '/(^|&)kodety-release(?:=[^&]*)?(?=&|$)/i',
            static fn(array $match): string => ($match[1] ?? '') . $parameter,
            $query
        );
    } else {
        $query .= ($query === '' || str_ends_with($query, '&') ? '' : '&') . $parameter;
    }
    return $prefix . $path . '?' . $query . $fragment . $suffix;
}

/** @return list<array{tag:string,name:string,offset:int,length:int}> */
function kodety_runtime_local_asset_tag_spans(string $html): array {
    $assets = [];
    $inert_stack = [];
    $length = strlen($html);
    $cursor = 0;
    while ($cursor < $length) {
        $tag_start = strpos($html, '<', $cursor);
        if ($tag_start === false) break;
        if (substr($html, $tag_start, 4) === '<!--') {
            $comment_end = strpos($html, '-->', $tag_start + 4);
            if ($comment_end === false) break;
            $cursor = $comment_end + 3;
            continue;
        }
        $tag_end = kodety_runtime_tag_end_offset($html, $tag_start);
        if ($tag_end === null) break;
        $tag = substr($html, $tag_start, $tag_end - $tag_start + 1);
        if (!preg_match(
            '~^<\s*(/?)\s*([a-z][a-z0-9:-]*)(?=[\s/>])~i',
            $tag,
            $name_match
        )) {
            $cursor = $tag_end + 1;
            continue;
        }
        $closing = ($name_match[1] ?? '') === '/';
        $name = strtolower((string) ($name_match[2] ?? ''));
        $inert = in_array(
            $name,
            ['script', 'style', 'title', 'textarea', 'template', 'noscript', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'],
            true
        );
        if ($closing && $inert) {
            if (($inert_stack[count($inert_stack) - 1] ?? null) === $name) array_pop($inert_stack);
        } elseif (!$closing) {
            if (!$inert_stack && in_array($name, ['link', 'script'], true)) {
                $assets[] = [
                    'tag' => $tag,
                    'name' => $name,
                    'offset' => $tag_start,
                    'length' => $tag_end - $tag_start + 1,
                ];
            }
            if ($inert && !preg_match('~/\s*>$~', $tag)) $inert_stack[] = $name;
        }
        $cursor = $tag_end + 1;
    }
    return $assets;
}

/**
 * Cache-bust only executable/style assets in the public response. The
 * generated theme and its authoring workspace remain byte-for-byte intact.
 */
function kodety_version_runtime_local_asset_urls(string $html, ?string $release = null): string {
    $release = $release === null ? kodety_runtime_release() : trim($release);
    if (
        $html === ''
        || $release === ''
        || !preg_match('/^[A-Za-z0-9_-]{1,96}$/', $release)
        || (!str_contains(strtolower($html), '<link') && !str_contains(strtolower($html), '<script'))
    ) return $html;

    [$protected, $custom_code_blocks] = kodety_protect_runtime_custom_code_blocks($html);
    [$protected, $raw_text_payloads] = kodety_protect_runtime_raw_text_payloads(
        $protected,
        false,
        true
    );
    foreach (array_reverse(kodety_runtime_local_asset_tag_spans($protected)) as $asset) {
        $attribute_name = $asset['name'] === 'link' ? 'href' : 'src';
        if ($asset['name'] === 'link') {
            $rel = strtolower(trim((string) kodety_runtime_tag_attribute_value($asset['tag'], 'rel')));
            $relations = preg_split('/\s+/', $rel) ?: [];
            if (!in_array('stylesheet', $relations, true) && !in_array('modulepreload', $relations, true)) continue;
        }
        $attributes = kodety_runtime_tag_attributes($asset['tag']);
        $attribute = $attributes[$attribute_name] ?? null;
        if (!is_array($attribute) || !is_string($attribute['value'])) continue;
        $current = html_entity_decode($attribute['value'], ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $versioned = kodety_runtime_version_local_asset_url($current, $release);
        if ($versioned === $current) continue;
        $encoded = htmlspecialchars(
            $versioned,
            ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5,
            'UTF-8',
            false
        );
        $tag = substr_replace(
            $asset['tag'],
            $encoded,
            $attribute['valueOffset'],
            $attribute['valueLength']
        );
        $protected = substr_replace($protected, $tag, $asset['offset'], $asset['length']);
    }
    $protected = kodety_restore_runtime_raw_text_payloads($protected, $raw_text_payloads);
    return kodety_restore_runtime_custom_code_blocks($protected, $custom_code_blocks);
}

/** @return list<array{tag:string,offset:int,length:int}> */
function kodety_runtime_link_tag_spans(string $html, bool $head_only = false): array {
    $links = [];
    $inert_stack = [];
    $inside_head = !$head_only;
    $length = strlen($html);
    $cursor = 0;
    while ($cursor < $length) {
        $tag_start = strpos($html, '<', $cursor);
        if ($tag_start === false) break;
        if (substr($html, $tag_start, 4) === '<!--') {
            $comment_end = strpos($html, '-->', $tag_start + 4);
            if ($comment_end === false) break;
            $cursor = $comment_end + 3;
            continue;
        }
        $tag_end = kodety_runtime_tag_end_offset($html, $tag_start);
        if ($tag_end === null) break;
        $tag = substr($html, $tag_start, $tag_end - $tag_start + 1);
        if (!preg_match(
            '~^<\s*(/?)\s*([a-z][a-z0-9:-]*)(?=[\s/>])~i',
            $tag,
            $name_match
        )) {
            $cursor = $tag_end + 1;
            continue;
        }
        $closing = ($name_match[1] ?? '') === '/';
        $name = strtolower((string) ($name_match[2] ?? ''));
        if ($head_only && !$inside_head && !$inert_stack && !$closing && $name === 'body') {
            break;
        }
        if (
            $head_only
            && $inside_head
            && !$inert_stack
            && (($closing && $name === 'head') || (!$closing && $name === 'body'))
        ) break;
        $inert = in_array(
            $name,
            ['script', 'style', 'title', 'textarea', 'template', 'noscript', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'],
            true
        );
        if ($closing && $inert) {
            if (($inert_stack[count($inert_stack) - 1] ?? null) === $name) array_pop($inert_stack);
        } elseif (!$closing) {
            if ($head_only && !$inside_head && $name === 'head' && !$inert_stack) {
                $inside_head = true;
            } elseif ($inside_head && $name === 'link' && !$inert_stack) {
                $links[] = [
                    'tag' => $tag,
                    'offset' => $tag_start,
                    'length' => $tag_end - $tag_start + 1,
                ];
            }
            if ($inert && !preg_match('~/\s*>$~', $tag)) $inert_stack[] = $name;
        }
        $cursor = $tag_end + 1;
    }
    return $links;
}

/** @return list<string> */
function kodety_runtime_head_link_tags(string $html): array {
    [$protected] = kodety_protect_runtime_raw_text_payloads($html, false, true);
    return array_values(array_map(
        static fn(array $link): string => $link['tag'],
        kodety_runtime_link_tag_spans($protected, true)
    ));
}

/** @return list<string> */
function kodety_authored_favicon_link_tags(string $html): array {
    if (
        $html === ''
        || stripos($html, '<link') === false
    ) return [];

    $favicons = [];
    foreach (kodety_runtime_head_link_tags($html) as $tag) {
        $rel = strtolower(trim((string) kodety_runtime_tag_attribute_value($tag, 'rel')));
        $relations = preg_split('/\s+/', $rel) ?: [];
        if (!in_array('icon', $relations, true)) continue;
        $href = trim((string) kodety_runtime_tag_attribute_value($tag, 'href'));
        if ($href === '' || str_starts_with($href, '#')) continue;
        $scheme_probe = (string) preg_replace('/[\x00-\x20\x7f]+/', '', $href);
        $scheme = preg_match('~^([a-z][a-z0-9+.-]*):~i', $scheme_probe, $scheme_match)
            ? strtolower((string) ($scheme_match[1] ?? ''))
            : '';
        if ($scheme !== '' && !in_array($scheme, ['http', 'https', 'data'], true)) continue;
        if (
            $scheme === 'data'
            && !preg_match(
                '~^data:image/(?:avif|gif|jpe?g|png|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)(?:[;,])~i',
                $scheme_probe
            )
        ) continue;
        $favicons[] = $tag;
    }
    return array_values(array_unique($favicons));
}

function kodety_document_has_authored_favicon(string $html): bool {
    return kodety_authored_favicon_link_tags($html) !== [];
}

/** Remove only favicon-like links emitted by the WordPress hook fragment. */
function kodety_remove_competing_favicon_links(string $markup): string {
    if ($markup === '' || !preg_match('~<link(?=[\s/>])~i', $markup)) return $markup;
    [$protected, $raw_text_payloads] = kodety_protect_runtime_raw_text_payloads(
        $markup,
        false,
        true
    );
    $filtered = $protected;
    foreach (array_reverse(kodety_runtime_link_tag_spans($protected)) as $link) {
        $rel = strtolower(trim((string) kodety_runtime_tag_attribute_value($link['tag'], 'rel')));
        $relations = preg_split('/\s+/', $rel) ?: [];
        if (!array_intersect(
            $relations,
            ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon', 'fluid-icon']
        )) continue;
        $filtered = substr_replace($filtered, '', $link['offset'], $link['length']);
    }
    return kodety_restore_runtime_raw_text_payloads($filtered, $raw_text_payloads);
}

function kodety_capture_wordpress_head_for_document(string $html): string {
    $owns_favicon = kodety_document_has_authored_favicon($html);
    $core_site_icon_priorities = [];
    if ($owns_favicon) {
        while (($priority = has_action('wp_head', 'wp_site_icon')) !== false) {
            if (!remove_action('wp_head', 'wp_site_icon', (int) $priority)) break;
            $core_site_icon_priorities[] = (int) $priority;
        }
    }

    $buffer_level = ob_get_level();
    $wordpress_head = '';
    try {
        ob_start();
        wp_head();
        $wordpress_head = (string) ob_get_clean();
        if ($owns_favicon) {
            $wordpress_head = kodety_remove_competing_favicon_links($wordpress_head);
        }
    } finally {
        while (ob_get_level() > $buffer_level) ob_end_clean();
        foreach ($core_site_icon_priorities as $priority) {
            add_action('wp_head', 'wp_site_icon', $priority);
        }
    }
    return $wordpress_head;
}

/**
 * Only real CMS contracts require a DOM tree. Imported Framer documents carry
 * thousands of `data-kodety-framer-*` hydration markers; treating that broad
 * namespace as CMS work needlessly parses and serializes the complete page.
 */
function kodety_cms_html_requires_dom(string $html): bool {
    if (preg_match('~\bdata-kodety-collection\s*=~i', $html)) return true;
    if (!is_singular()) return false;
    if (preg_match('~\bdata-kodety-bind(?:-(?:content|title|href|src|alt))?\s*=~i', $html)) return true;
    if (!str_contains($html, '{{')) return false;
    if (preg_match('~<title\b[^>]*>[\s\S]*?\{\{[^{}]+\}\}[\s\S]*?</title\s*>~i', $html)) return true;
    if (preg_match('~<meta\b[^>]*\bcontent\s*=\s*(?:"[^"]*\{\{|\'[^\']*\{\{|[^\s>]*\{\{)[^>]*>~i', $html)) return true;
    if (preg_match('~<link\b[^>]*\bhref\s*=\s*(?:"[^"]*\{\{|\'[^\']*\{\{|[^\s>]*\{\{)[^>]*>~i', $html)) return true;
    return preg_match(
        '~<script\b(?=[^>]*\bdata-kodety-seo(?:\s*=|\s|>))[^>]*>[\s\S]*?\{\{[^{}]+\}\}[\s\S]*?</script\s*>~i',
        $html
    ) === 1;
}

/** Expand collection repeaters and singular bindings in trusted project HTML. */
function kodety_render_cms_html(string $html): string {
    if (!kodety_cms_html_requires_dom($html)) return $html;
    [$dom_html, $raw_text_payloads] = kodety_protect_runtime_raw_text_payloads(
        $html,
        true
    );
    $internal_errors = libxml_use_internal_errors(true);
    $document = new DOMDocument('1.0', 'UTF-8');
    $loaded = $document->loadHTML('<?xml encoding="utf-8" ?>' . $dom_html, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
    libxml_clear_errors();
    libxml_use_internal_errors($internal_errors);
    if (!$loaded) return $html;
    $xpath = new DOMXPath($document);
    $filter_fields_by_collection = [];
    foreach ($xpath->query('//form[@data-kodety-form-mode="filter" and @data-kodety-filter-collection and @data-kodety-filter-map]') ?: [] as $filter_form) {
        if (!$filter_form instanceof DOMElement) continue;
        $collection = sanitize_key($filter_form->getAttribute('data-kodety-filter-collection'));
        $mapping = json_decode($filter_form->getAttribute('data-kodety-filter-map'), true);
        if ($collection === '' || !is_array($mapping)) continue;
        foreach ($mapping as $rule) {
            $field = is_array($rule) ? sanitize_text_field((string) ($rule['field'] ?? '')) : '';
            if ($field !== '') $filter_fields_by_collection[$collection][$field] = true;
        }
    }
    if (is_singular()) {
        $seo_post = get_queried_object();
        if ($seo_post instanceof WP_Post) kodety_cms_resolve_seo_head($document, $seo_post);
    }
    // Always render the outermost collection first. Removing its configuration
    // exposes any nested collection copied into each item, which is then
    // processed by the next iteration with its own content context.
    $rendered_collections = 0;
    while ($rendered_collections < 1000) {
        $container = null;
        foreach ($xpath->query('//*[@data-kodety-collection and not(ancestor::*[@data-kodety-collection])]') ?: [] as $candidate) {
            if ($candidate instanceof DOMElement) { $container = $candidate; break; }
        }
        if (!$container instanceof DOMElement) break;
        $rendered_collections++;
        $post_type = sanitize_key($container->getAttribute('data-kodety-collection'));
        if ($post_type === '' || !post_type_exists($post_type)) {
            $container->removeAttribute('data-kodety-collection');
            $container->setAttribute('data-kodety-cms-error', 'unknown-collection');
            continue;
        }
        $limit = max(1, min(100, (int) ($container->getAttribute('data-kodety-limit') ?: 6)));
        $orderby = sanitize_key($container->getAttribute('data-kodety-orderby') ?: 'date');
        if (!in_array($orderby, ['date', 'modified', 'title', 'menu_order', 'rand'], true)) $orderby = 'date';
        $order = strtoupper($container->getAttribute('data-kodety-order')) === 'ASC' ? 'ASC' : 'DESC';
        $template = null;
        foreach ($xpath->query('.//*[@data-kodety-collection-item]', $container) ?: [] as $candidate) {
            if (!$candidate instanceof DOMElement || !kodety_cms_belongs_to_collection($candidate, $container)) continue;
            $template = $candidate;
            break;
        }
        $repeat_self = !$template && strtolower($container->getAttribute('data-kodety-repeat')) !== 'child';
        if ($repeat_self) $template = $container;
        elseif (!$template) foreach ($container->childNodes as $candidate) { if ($candidate instanceof DOMElement && !$candidate->hasAttribute('data-kodety-empty-state')) { $template = $candidate; break; } }
        if (!$template || !$template->parentNode) {
            $container->removeAttribute('data-kodety-collection');
            $container->setAttribute('data-kodety-cms-error', 'missing-item-template');
            continue;
        }
        $parent = $template->parentNode;
        $anchor = $template->nextSibling;
        $filter_fields = array_keys($filter_fields_by_collection[$post_type] ?? []);
        $filterable = $filter_fields !== [];
        $items = get_posts(['post_type' => $post_type, 'post_status' => 'publish', 'numberposts' => $filterable ? 100 : $limit, 'orderby' => $orderby, 'order' => $order]);
        foreach ($items as $item_index => $item) {
            $clone = $template->cloneNode(true);
            if (!$clone instanceof DOMElement) continue;
            $clone->removeAttribute('data-kodety-collection-item');
            if ($repeat_self) foreach (['data-kodety-collection', 'data-kodety-limit', 'data-kodety-orderby', 'data-kodety-order', 'data-kodety-repeat'] as $attribute) $clone->removeAttribute($attribute);
            $clone->setAttribute('data-kodety-item-id', (string) $item->ID);
            if ($filterable) {
                $clone->setAttribute('data-kodety-rendered-item', $post_type);
                $clone->setAttribute('data-kodety-filter-limit', (string) $limit);
                $clone->setAttribute('data-kodety-filter-values', (string) wp_json_encode(
                    kodety_cms_filter_payload($item, $filter_fields),
                    JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
                ));
                if ($item_index >= $limit) $clone->setAttribute('hidden', '');
            }
            kodety_cms_strip_empty_states($clone, true);
            kodety_apply_cms_bindings($clone, $item, false, true);
            $parent->insertBefore($clone, $anchor);
        }
        if ($items) {
            $parent->removeChild($template);
            if (!$repeat_self) {
                kodety_cms_strip_empty_states($container, true);
                $container->setAttribute('data-kodety-rendered-collection', $post_type);
                foreach (['data-kodety-collection', 'data-kodety-limit', 'data-kodety-orderby', 'data-kodety-order', 'data-kodety-repeat'] as $attribute) {
                    $container->removeAttribute($attribute);
                }
            }
            continue;
        }
        // Empty collection: keep elements marked data-kodety-empty-state visible
        // and flag the container so the project CSS can style the empty layout.
        if ($repeat_self) {
            if (kodety_cms_has_empty_state($container)) {
                foreach (iterator_to_array($container->childNodes) as $child) {
                    if (!($child instanceof DOMElement && $child->hasAttribute('data-kodety-empty-state'))) $container->removeChild($child);
                }
                foreach (['data-kodety-collection', 'data-kodety-limit', 'data-kodety-orderby', 'data-kodety-order', 'data-kodety-repeat'] as $attribute) {
                    $container->removeAttribute($attribute);
                }
                $container->setAttribute('data-kodety-rendered-collection', $post_type);
                $container->setAttribute('data-kodety-empty', 'true');
            } else {
                $parent->removeChild($container);
            }
            continue;
        }
        $parent->removeChild($template);
        foreach (['data-kodety-collection', 'data-kodety-limit', 'data-kodety-orderby', 'data-kodety-order', 'data-kodety-repeat'] as $attribute) {
            $container->removeAttribute($attribute);
        }
        $container->setAttribute('data-kodety-rendered-collection', $post_type);
        $container->setAttribute('data-kodety-empty', 'true');
    }
    if (is_singular()) {
        $post = get_queried_object();
        if ($post instanceof WP_Post && $document->documentElement instanceof DOMElement) {
            kodety_apply_cms_bindings($document->documentElement, $post, true);
        }
    }
    $result = kodety_save_runtime_html($document);
    return is_string($result)
        ? kodety_cleanup_runtime_html(
            kodety_restore_runtime_raw_text_payloads($result, $raw_text_payloads)
        )
        : $html;
}

/** Localization lives in the portable project metadata, so the editor, ZIP
 * export and generated theme always read the exact same configuration. */
function kodety_localization_settings(): array {
    static $settings = null;
    if (is_array($settings)) return $settings;
    $private_path = kodety_runtime_directory() . '/membership-localization.php';
    $private = is_file($private_path) ? include $private_path : [];
    $public_path = kodety_runtime_directory() . '/localization.json';
    $public = is_array($private) && isset($private['locales'])
        ? $private
        : (is_file($public_path) ? json_decode((string) file_get_contents($public_path), true) : []);
    if (is_array($public) && isset($public['locales'])) {
        $candidate = $public;
    } else {
        // Backwards compatibility for releases created before localization was
        // exported as a dedicated public payload.
        $legacy_path = kodety_runtime_directory() . '/site/.incode/project.json';
        $metadata = is_file($legacy_path) ? json_decode((string) file_get_contents($legacy_path), true) : [];
        $candidate = is_array($metadata) && is_array($metadata['localization'] ?? null) ? $metadata['localization'] : [];
    }
    $settings = array_merge([
        'version' => 2,
        'sourceLocale' => 'pt-BR', 'defaultLocale' => 'pt-BR', 'automaticLocale' => true, 'rememberLocale' => true,
        'translatePagePaths' => false, 'locales' => [], 'translations' => [],
    ], $candidate);
    return $settings;
}

function kodety_localization_enabled_locales(array $settings): array {
    return array_values(array_filter((array) ($settings['locales'] ?? []), static fn(mixed $locale): bool => is_array($locale) && !empty($locale['code']) && ($locale['enabled'] ?? true)));
}

/**
 * Decode and normalize one public route in a stable, traversal-safe form.
 *
 * Accepted values become idempotent: percent escapes are decoded exactly once
 * and a still-encoded second layer is rejected. This lets the request parser,
 * manifest lookup and translated-path matcher share the same representation
 * without an encoded route changing meaning as it moves through the runtime.
 */
function kodety_normalize_public_route_path(string $path): ?string {
    if (str_contains($path, "\0") || preg_match('/[\x00-\x1F\x7F]/', $path)) return null;
    $decoded = rawurldecode($path);
    if (
        str_contains($decoded, "\0")
        || preg_match('/[\x00-\x1F\x7F]/', $decoded)
        || preg_match('/%[0-9a-f]{2}/i', $decoded)
    ) return null;
    $decoded = str_replace('\\', '/', $decoded);
    if (class_exists('Normalizer')) {
        $normalized_unicode = Normalizer::normalize($decoded, Normalizer::FORM_C);
        if (is_string($normalized_unicode)) $decoded = $normalized_unicode;
    }
    $segments = [];
    foreach (explode('/', trim($decoded, '/')) as $segment) {
        if ($segment === '') continue;
        if ($segment === '.' || $segment === '..') return null;
        $segments[] = $segment;
    }
    return implode('/', $segments);
}

/** Resolve the locale prefix and map an optional translated page path back to
 * the base manifest route. */
function kodety_localization_request(string $request_path, array $settings, array $manifest = []): array {
    $normalized_request = kodety_normalize_public_route_path($request_path);
    if ($normalized_request === null) {
        return [
            'locale_code' => (string) ($settings['defaultLocale'] ?? $settings['sourceLocale'] ?? 'pt-BR'),
            'locale_slug' => '',
            'prefixed' => false,
            'localized_route' => '',
            'base_route' => '__kodety-invalid-route__',
        ];
    }
    $segments = $normalized_request === '' ? [] : explode('/', $normalized_request);
    $source = (string) ($settings['sourceLocale'] ?? 'pt-BR');
    $default = (string) ($settings['defaultLocale'] ?? $source);
    $locale_code = $default;
    $locale_slug = '';
    $prefixed = false;
    foreach (kodety_localization_enabled_locales($settings) as $locale) {
        $slug = kodety_normalize_public_route_path((string) ($locale['slug'] ?? ''));
        if ($slug === null) continue;
        if ($slug === '' || ($segments[0] ?? '') !== $slug) continue;
        $locale_code = (string) $locale['code'];
        $locale_slug = $slug;
        array_shift($segments);
        $prefixed = true;
        break;
    }
    $localized_route = trim(implode('/', $segments), '/');
    $base_route = $localized_route;
    if (!empty($settings['translatePagePaths']) && $locale_code !== $source) {
        foreach ((array) ($settings['translations'][$locale_code]['pages'] ?? []) as $html_path => $page) {
            if (!is_array($page)) continue;
            $translated = kodety_normalize_public_route_path((string) ($page['path'] ?? ''));
            if ($translated === null) continue;
            if ($translated === '' || $translated !== $localized_route) continue;
            $canonical_routes = kodety_manifest_canonical_routes($manifest);
            $normalized_html_path = strtolower(trim(str_replace('\\', '/', (string) $html_path), '/'));
            $base_route = $canonical_routes[$normalized_html_path]
                ?? kodety_manifest_public_route_for_path($manifest, (string) $html_path);
            break;
        }
    }
    return compact('locale_code', 'locale_slug', 'prefixed', 'localized_route', 'base_route');
}

/** The requested URL is authoritative for ordinary generated pages.
 * WordPress may resolve an unknown pretty URL to the configured front page;
 * that queried page must not replace an exact generated manifest route. */
function kodety_resolve_page_relative(
    array $manifest,
    string $request_path,
    string $page_relative = '',
    string $cms_relative = ''
): string {
    $request_path = kodety_normalize_public_route_path($request_path);
    if ($request_path === null) return '404.html';
    $manifest_relative = kodety_manifest_relative_for_request($manifest, $request_path);
    if ($cms_relative !== '') return $cms_relative;
    if ($manifest_relative !== '') return $manifest_relative;
    if ($page_relative !== '') return $page_relative;
    return is_string($manifest[''] ?? null) && $request_path === ''
        ? (string) $manifest['']
        : kodety_404_page_relative($manifest);
}

/** Resolve the authored 404 document, including folder-style routes such as
 * `404/index.html`. A missing authored 404 page is represented by the
 * generated default document in index.php. */
function kodety_404_page_relative(array $manifest): string {
    foreach ($manifest as $route => $file) {
        if (is_int($route)) $route = (string) $route;
        if (!is_string($route) || !is_string($file)) continue;
        if (kodety_normalize_public_route_path($route) !== '404') continue;
        $file = trim(str_replace('\\', '/', $file), '/');
        if ($file !== '') return $file;
    }
    return '404.html';
}

/** Self-contained fallback shown when a published project has no authored
 * 404 page. Keep the branding here instead of depending on the site's asset
 * tree, because the fallback must also work for an empty or partial release. */
function kodety_default_404_html(): string {
    $kodety_url = esc_url(home_url('/'));
    $home_url = esc_url(home_url('/'));

    return str_replace('\\n', "\n", '<!doctype html>\n'
        . '<html lang="en">\n'
        . '<head>\n'
        . '<meta charset="utf-8">\n'
        . '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        . '<title>Page Not Found</title>\n'
        . '<style>\n'
        . ':root{color-scheme:light;--kodety-404-bg:#fff;--kodety-404-fg:#343434;--kodety-404-muted:#898989;--kodety-404-button:#0a98ee;--kodety-404-button-hover:#0787d5}\n'
        . '@media (prefers-color-scheme:dark){:root{color-scheme:dark;--kodety-404-bg:#151515;--kodety-404-fg:#f5f5f5;--kodety-404-muted:#a6a6a6;--kodety-404-button:#35a5f2;--kodety-404-button-hover:#62bbfa}}\n'
        . '*{box-sizing:border-box}\n'
        . 'html,body{min-height:100%;margin:0}\n'
        . 'body{display:grid;place-items:center;min-height:100vh;min-height:100svh;padding:32px;background:var(--kodety-404-bg);color:var(--kodety-404-fg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;-webkit-font-smoothing:antialiased}\n'
        . 'main{display:flex;flex-direction:column;align-items:center;max-width:460px;transform:translateY(-3vh)}\n'
        . '.kodety-404__logo{display:inline-flex;width:32px;height:32px;margin:0 0 28px;color:var(--kodety-404-fg);transition:opacity .2s ease}\n'
        . '.kodety-404__logo:hover{opacity:.7}\n'
        . '.kodety-404__logo:focus-visible,.kodety-404__home:focus-visible{outline:3px solid color-mix(in srgb,var(--kodety-404-button) 45%,transparent);outline-offset:5px}\n'
        . 'svg{display:block;width:100%;height:100%}\n'
        . 'h1{margin:0 0 14px;font-size:20px;font-weight:650;line-height:1.25;letter-spacing:-.01em}\n'
        . 'p{max-width:330px;margin:0 0 32px;color:var(--kodety-404-muted);font-size:18px;font-weight:500;line-height:1.45}\n'
        . '.kodety-404__home{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 15px;border-radius:12px;background:var(--kodety-404-button);color:#fff;font-size:16px;font-weight:650;line-height:1;text-decoration:none;transition:background-color .2s ease,transform .2s ease}\n'
        . '.kodety-404__home:hover{background:var(--kodety-404-button-hover);transform:translateY(-1px)}\n'
        . '@media (max-width:480px){body{padding:24px}p{font-size:16px}}\n'
        . '</style>\n'
        . '</head>\n'
        . '<body data-kodety-default-404>\n'
        . '<main>\n'
        . '<a class="kodety-404__logo" href="' . $kodety_url . '" aria-label="Onun Kodety">'
        . '<svg viewBox="0 0 100 100" role="img" aria-hidden="true" focusable="false">'
        . '<g transform="translate(7.56 4.25) scale(.75)" fill="currentColor">'
        . '<path d="M51.1932 122L0 61L113.183 94.8289V122H51.1932Z"/>'
        . '<path d="M51.1932 0L0 61L113.183 27.1711V0H51.1932Z"/>'
        . '</g></svg></a>\n'
        . '<h1>Page Not Found</h1>\n'
        . '<p>The page you are looking for does not exist or may have been moved.</p>\n'
        . '<a class="kodety-404__home" href="' . $home_url . '">Back to Home</a>\n'
        . '</main>\n'
        . '</body>\n'
        . '</html>');
}

/**
 * Experiment variants are stored in a private runtime namespace, but their
 * authored document path still belongs to the public project. Link,
 * localization and fragment resolution must therefore operate on the suffix
 * after `<experiment>/<variant>/`, never on `.kodety-experiments/...`.
 */
function kodety_authored_relative_for_runtime(string $relative): string {
    $relative = ltrim(str_replace('\\', '/', $relative), '/');
    if (preg_match('~^\.kodety-experiments/[^/]+/[^/]+/(.+)$~', $relative, $matches)) {
        return ltrim((string) $matches[1], '/');
    }
    return $relative;
}

/** Resolve both the canonical extensionless route and the original Webflow
 * `.html` URL without duplicating entries in the published manifest. */
function kodety_manifest_relative_for_request(array $manifest, string $request_path): string {
    $request_path = kodety_normalize_public_route_path($request_path);
    if ($request_path === null) return '';
    $candidates = [$request_path];
    if (preg_match('/\.html?$/i', $request_path)) {
        $without_extension = (string) preg_replace('/\.html?$/i', '', $request_path);
        $candidates[] = preg_replace('/(?:^|\/)index$/i', '', $without_extension) ?? $without_extension;
    }
    $candidates = array_values(array_unique(array_map(
        static fn(string $candidate): string => trim($candidate, '/'),
        $candidates
    )));
    $canonical_routes = kodety_manifest_canonical_routes($manifest);
    foreach ($manifest as $route => $file) {
        if (is_int($route)) $route = (string) $route;
        if (!is_string($route) || !is_string($file)) continue;
        $normalized_route = kodety_normalize_public_route_path($route);
        $normalized_file = strtolower(trim(str_replace('\\', '/', $file), '/'));
        $canonical_route = $canonical_routes[$normalized_file] ?? null;
        foreach ($candidates as $candidate) {
            // The original route remains a backwards-compatible alias, while
            // every newly generated link uses the canonical public route.
            if ($normalized_route === $candidate || $canonical_route === $candidate) return $file;
        }
    }
    return '';
}

function kodety_normalize_project_link_path(string $current_html_path, string $reference): string {
    $reference = str_replace('\\', '/', rawurldecode($reference));
    $base = str_starts_with($reference, '/') ? [] : array_values(array_filter(explode('/', trim(str_replace('\\', '/', dirname($current_html_path)), './'))));
    foreach (explode('/', ltrim($reference, '/')) as $segment) {
        if ($segment === '' || $segment === '.') continue;
        if ($segment === '..') array_pop($base);
        else $base[] = $segment;
    }
    return implode('/', $base);
}

/** One published file answers on more than one manifest route: the project's
 * main page is also the site root, and Webflow exports keep the `.html` alias.
 * Public links must always use a single canonical route — the site root wins,
 * otherwise the shortest one — so neither `.html` nor a duplicated project
 * sub-folder can ever reach the address bar. */
function kodety_manifest_canonical_routes(array $manifest): array {
    $routes = [];
    $web_root = trim(str_replace('\\', '/', dirname((string) ($manifest[''] ?? ''))), './');
    foreach ($manifest as $route => $file) {
        if (is_int($route)) $route = (string) $route;
        if (!is_string($route) || !is_string($file)) continue;
        $key = strtolower(trim(str_replace('\\', '/', $file), '/'));
        if ($key === '') continue;
        $route = kodety_normalize_public_route_path($route);
        if ($route === null) continue;
        if ($web_root !== '' && stripos($route . '/', $web_root . '/') === 0) {
            $route = ltrim(substr($route, strlen($web_root)), '/');
        }
        $current = $routes[$key] ?? null;
        if ($current === null || ($current !== '' && ($route === '' || strlen($route) < strlen($current)))) {
            $routes[$key] = $route;
        }
    }
    return $routes;
}

/** The folder the project's main page was published from. A root-relative
 * authored URL (`/src/main.js`, `url(/images/hero.webp)`) means "from the
 * project root", so it must resolve against this folder — never against the
 * directory of the page being served, and never against a variant clone's own
 * root, which would drop the folder entirely. */
function kodety_project_web_root(array $manifest): string {
    $main = trim(str_replace('\\', '/', (string) ($manifest[''] ?? '')), '/');
    if ($main === '') return '';
    $directory = trim(str_replace('\\', '/', dirname($main)), './');
    return $directory;
}

/** Resolve a root-relative authored asset without rewriting its HTML, CSS or
 * JavaScript reference. WordPress normally owns `/`, while coded projects
 * legitimately use `/images/hero.webp`, `/assets/app.js`, `fetch('/data.json')`
 * and similar paths. Serving an exact matching file from the generated site's
 * web root preserves that browser contract and keeps the source byte-identical.
 */
function kodety_project_root_asset_path(
    string $request_path,
    ?array $manifest = null,
    ?string $runtime_directory = null
): string {
    $path = rawurldecode((string) (preg_split('/[?#]/', $request_path, 2)[0] ?? ''));
    $path = ltrim(str_replace('\\', '/', $path), '/');
    if (
        $path === ''
        || str_contains($path, "\0")
        || preg_match('~(?:^|/)\.\.?(/|$)~', $path)
        || preg_match('~(?:^|/)\.[^/]+(?:/|$)~', $path)
        || preg_match('/\.(?:php\d*|phtml|phar|html?)$/i', $path)
    ) return '';

    $directory = $runtime_directory !== null
        ? rtrim($runtime_directory, '/\\')
        : kodety_runtime_directory();
    if ($manifest === null) {
        $manifest_path = $directory . '/manifest.json';
        $decoded = is_file($manifest_path)
            ? json_decode((string) file_get_contents($manifest_path), true)
            : [];
        $manifest = is_array($decoded) ? $decoded : [];
    }
    $site_root = realpath($directory . '/site');
    if ($site_root === false || !is_dir($site_root)) return '';
    $web_root = kodety_project_web_root($manifest);
    $candidate = realpath(
        $site_root
        . ($web_root === '' ? '' : '/' . $web_root)
        . '/' . $path
    );
    if (
        $candidate === false
        || !is_file($candidate)
        || is_link($candidate)
        || !str_starts_with($candidate, rtrim($site_root, '/\\') . DIRECTORY_SEPARATOR)
    ) return '';
    return $candidate;
}

function kodety_serve_project_root_asset(): void {
    if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) return;
    $request_path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $home_path = (string) parse_url(home_url('/'), PHP_URL_PATH);
    if ($home_path !== '/' && $home_path !== '' && str_starts_with($request_path, $home_path)) {
        $request_path = substr($request_path, strlen($home_path));
    }
    $asset = kodety_project_root_asset_path($request_path);
    if ($asset === '') return;

    $type = function_exists('wp_check_filetype')
        ? (string) (wp_check_filetype($asset)['type'] ?? '')
        : '';
    if ($type === '' && function_exists('mime_content_type')) {
        $detected = mime_content_type($asset);
        if (is_string($detected)) $type = $detected;
    }
    if ($type === '') $type = 'application/octet-stream';
    while (ob_get_level() > 0) ob_end_clean();
    status_header(200);
    header('Content-Type: ' . $type);
    header('Content-Length: ' . (string) (filesize($asset) ?: 0));
    header('Cache-Control: public, max-age=3600');
    header('X-Content-Type-Options: nosniff');
    readfile($asset);
    exit;
}
add_action('template_redirect', 'kodety_serve_project_root_asset', -120);

/** Derive a public route for an authored file the manifest does not list.
 * The project's web root (the folder its main page was published from) is a
 * private packaging detail, and `.html` is never part of a public URL. */
function kodety_manifest_public_route_for_path(array $manifest, string $path): string {
    $normalized_path = kodety_normalize_public_route_path($path);
    if ($normalized_path === null) return '';
    $path = $normalized_path;
    $web_root = trim(str_replace('\\', '/', dirname((string) ($manifest[''] ?? ''))), './');
    if ($web_root !== '' && stripos($path . '/', $web_root . '/') === 0) {
        $path = ltrim(substr($path, strlen($web_root)), '/');
    }
    $path = (string) preg_replace('~(?:^|/)index\.html?$~i', '', $path);
    return trim((string) preg_replace('/\.html?$/i', '', $path), '/');
}

/** Build the client-side route map used for links created after PHP has
 * finished rendering the document. The authored asset base remains private;
 * every page target resolves through the public WordPress origin. */
function kodety_public_routes_runtime_config(
    string $current_html_path,
    array $manifest,
    array $locale_request = [],
    array $localization = [],
    string $asset_root = ''
): array {
    $canonical_routes = kodety_manifest_canonical_routes($manifest);
    $routes = [];
    $route_aliases = [];
    $locale_code = (string) ($locale_request['locale_code'] ?? '');
    $public_path_for = static function (string $file, string $route) use ($manifest, $locale_request, $localization, $locale_code): string {
        $public_path = trim(str_replace('\\', '/', $route), '/');
        if (!empty($localization['translatePagePaths']) && $locale_code !== '') {
            $localized_path = kodety_localization_page_route($file, $locale_code, $localization, $manifest);
            if ($localized_path !== '') $public_path = $localized_path;
        } elseif (!empty($locale_request['prefixed']) && !empty($locale_request['locale_slug'])) {
            $public_path = trim((string) $locale_request['locale_slug'], '/') . '/' . ltrim($public_path, '/');
        }
        return trim($public_path, '/');
    };

    foreach ($canonical_routes as $file => $route) {
        $normalized_file = strtolower(trim(str_replace('\\', '/', (string) $file), '/'));
        if ($normalized_file === '') continue;
        $public_path = $public_path_for((string) $file, (string) $route);
        $url = kodety_runtime_public_url($public_path);
        $routes[$normalized_file] = $url;
        $without_extension = strtolower((string) preg_replace('/\.html?$/i', '', $normalized_file));
        if ($without_extension !== '') $route_aliases[$without_extension] = $url;
        $route_key = strtolower(trim(str_replace('\\', '/', (string) $route), '/'));
        if ($route_key !== '') $route_aliases[$route_key] = $url;
    }

    $normalized_current = strtolower(trim(str_replace('\\', '/', $current_html_path), '/'));
    $current_url = $routes[$normalized_current] ?? '';
    if ($current_url === '') {
        $fallback_route = kodety_manifest_public_route_for_path($manifest, $current_html_path);
        $current_url = kodety_runtime_public_url($fallback_route);
    }
    if ($asset_root === '') {
        $web_root = kodety_project_web_root($manifest);
        $asset_root = trailingslashit(kodety_runtime_directory_uri() . '/site' . ($web_root === '' ? '' : '/' . $web_root));
    }
    $public_base_path = '';
    if (!empty($localization['translatePagePaths']) && $locale_code !== '') {
        $default_locale = (string) ($localization['defaultLocale'] ?? $localization['sourceLocale'] ?? '');
        if ($locale_code !== $default_locale) {
            foreach (kodety_localization_enabled_locales($localization) as $locale) {
                if ((string) ($locale['code'] ?? '') !== $locale_code) continue;
                $public_base_path = trim((string) ($locale['slug'] ?? ''), '/');
                break;
            }
        }
    } elseif (!empty($locale_request['prefixed']) && !empty($locale_request['locale_slug'])) {
        $public_base_path = trim((string) $locale_request['locale_slug'], '/');
    }

    $locale_options = [];
    foreach (kodety_localization_enabled_locales($localization) as $locale) {
        $code = (string) ($locale['code'] ?? '');
        if ($code === '') continue;
        $locale_options[] = [
            'code' => $code,
            'name' => (string) ($locale['name'] ?? $code),
            'direction' => ($locale['direction'] ?? 'ltr') === 'rtl' ? 'rtl' : 'ltr',
            'url' => kodety_runtime_public_url(user_trailingslashit(
                kodety_localization_page_route($current_html_path, $code, $localization, $manifest)
            )),
            'current' => strcasecmp($code, $locale_code) === 0,
        ];
    }

    return [
        'version' => 1,
        'currentFile' => trim(str_replace('\\', '/', $current_html_path), '/'),
        'currentUrl' => $current_url,
        'publicBase' => trailingslashit(kodety_runtime_public_url($public_base_path)),
        'assetRoot' => trailingslashit($asset_root),
        'webRoot' => kodety_project_web_root($manifest),
        'routes' => $routes,
        'routeAliases' => $route_aliases,
        'localization' => [
            'rememberLocale' => ($localization['rememberLocale'] ?? true) !== false,
            'cookiePath' => defined('COOKIEPATH') && COOKIEPATH ? (string) COOKIEPATH : '/',
            'options' => $locale_options,
        ],
    ];
}

function kodety_inject_public_routes_runtime(
    string $html,
    string $current_html_path,
    array $manifest,
    array $locale_request = [],
    array $localization = [],
    string $asset_root = ''
): string {
    if (str_contains($html, 'data-kodety-public-routes-runtime')) return $html;
    $runtime_url = defined('KODETY_URL') ? KODETY_URL . 'assets/public-routes-runtime.js' : '';
    if ($runtime_url === '') return $html;
    $runtime_path = defined('KODETY_DIR') ? KODETY_DIR . 'assets/public-routes-runtime.js' : '';
    $runtime_version = $runtime_path !== '' && is_file($runtime_path)
        ? (string) filemtime($runtime_path)
        : (defined('KODETY_VERSION') ? KODETY_VERSION : '1');
    $config = wp_json_encode(
        kodety_public_routes_runtime_config($current_html_path, $manifest, $locale_request, $localization, $asset_root),
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );
    $markup = '<script type="application/json" id="kodety-public-routes-config">'
        . str_replace('</', '<\/', (string) $config)
        . '</script><script src="' . esc_url($runtime_url . '?ver=' . rawurlencode((string) $runtime_version))
        . '" defer data-kodety-public-routes-runtime></script>';
    return preg_match('/<\/body\s*>/i', $html)
        ? (string) preg_replace('/<\/body\s*>/i', $markup . '</body>', $html, 1)
        : $html . $markup;
}

/** Keep the theme asset base private to assets. Relative links to authored
 * pages must navigate through the public WordPress origin instead of exposing
 * `/wp-content/themes/kodety-generated/site` in the browser address bar. */
function kodety_rewrite_public_page_links(
    string $html,
    string $current_html_path,
    array $manifest,
    array $locale_request = [],
    array $localization = []
): string {
    $manifest_files = [];
    $canonical_routes = kodety_manifest_canonical_routes($manifest);
    $normalized_current_html_path = strtolower(trim(str_replace('\\', '/', $current_html_path), '/'));
    foreach ($manifest as $file) {
        if (!is_string($file)) continue;
        $normalized_file = trim(str_replace('\\', '/', $file), '/');
        if ($normalized_file !== '') $manifest_files[strtolower($normalized_file)] = $normalized_file;
    }
    $current_public_path = $canonical_routes[$normalized_current_html_path] ?? null;
    if (!$manifest_files) return $html;
    [$html, $raw_text_payloads] = kodety_protect_runtime_raw_text_payloads($html);

    $locale_code = (string) ($locale_request['locale_code'] ?? '');
    if ($current_public_path !== null) {
        if (!empty($localization['translatePagePaths']) && $locale_code !== '') {
            $localized_path = kodety_localization_page_route($current_html_path, $locale_code, $localization, $manifest);
            if ($localized_path !== '') $current_public_path = $localized_path;
        } elseif (!empty($locale_request['prefixed']) && !empty($locale_request['locale_slug'])) {
            $current_public_path = trim((string) $locale_request['locale_slug'], '/') . '/' . ltrim($current_public_path, '/');
        }
    }
    $current_public_url = $current_public_path !== null ? kodety_runtime_public_url($current_public_path) : '';

    $rewritten = (string) preg_replace_callback('~<(?:a|area)\b[^>]*>~i', static function (array $tag_match) use ($current_html_path, $manifest, $manifest_files, $canonical_routes, $locale_request, $localization, $current_public_url): string {
        return (string) preg_replace_callback('~\bhref\s*=\s*(["\'])(.*?)\1~is', static function (array $href_match) use ($current_html_path, $manifest, $manifest_files, $canonical_routes, $locale_request, $localization, $current_public_url): string {
            $href = html_entity_decode(trim((string) $href_match[2]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            if ($href === '') return $href_match[0];
            // A fragment-only href is otherwise resolved against the theme's
            // asset <base>, exposing /wp-content/themes/.../site/#section.
            if (str_starts_with($href, '#')) {
                if ($current_public_url === '') return $href_match[0];
                return 'href=' . $href_match[1] . esc_url($current_public_url . $href) . $href_match[1];
            }
            if (str_starts_with($href, '//') || preg_match('~^[a-z][a-z0-9+.-]*:~i', $href)) return $href_match[0];
            $parsed = parse_url($href);
            if (!is_array($parsed) || empty($parsed['path'])) return $href_match[0];

            $candidate = kodety_normalize_project_link_path($current_html_path, (string) $parsed['path']);
            $target_file = $manifest_files[strtolower($candidate)] ?? kodety_manifest_relative_for_request($manifest, $candidate);
            // A page the manifest does not list must still never resolve
            // against the private asset <base>. Anything else (images, PDFs,
            // downloads) legitimately belongs to that asset base.
            if ($target_file === '' && !preg_match('/\.html?$/i', $candidate)) return $href_match[0];
            $public_path = $target_file !== ''
                ? ($canonical_routes[strtolower(trim(str_replace('\\', '/', $target_file), '/'))] ?? '')
                : kodety_manifest_public_route_for_path($manifest, $candidate);

            $locale_code = (string) ($locale_request['locale_code'] ?? '');
            if (!empty($localization['translatePagePaths']) && $locale_code !== '' && $target_file !== '') {
                $localized_path = kodety_localization_page_route($target_file, $locale_code, $localization, $manifest);
                if ($localized_path !== '') $public_path = $localized_path;
            } elseif (!empty($locale_request['prefixed']) && !empty($locale_request['locale_slug'])) {
                $public_path = trim((string) $locale_request['locale_slug'], '/') . '/' . ltrim($public_path, '/');
            }

            $url = kodety_runtime_public_url($public_path);
            if (isset($parsed['query'])) $url .= '?' . $parsed['query'];
            if (isset($parsed['fragment'])) $url .= '#' . $parsed['fragment'];
            return 'href=' . $href_match[1] . esc_url($url) . $href_match[1];
        }, $tag_match[0], 1);
    }, $html);
    return kodety_restore_runtime_raw_text_payloads($rewritten, $raw_text_payloads);
}

/** Localized paths are virtual routes resolved by the generated theme. Keep
 * WordPress' canonical resolver from treating `/pt`, `/en`, etc. as typos and
 * redirecting them back to an unrelated native page or to the homepage. */
add_filter('redirect_canonical', static function (mixed $redirect_url, string $requested_url = ''): mixed {
    $context = kodety_runtime_context();
    $raw_request_path = isset($context['route'])
        ? trim((string) $context['route'], '/')
        : trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
    $normalized_request_path = kodety_normalize_public_route_path($raw_request_path);
    $request_path = $normalized_request_path ?? $raw_request_path;
    if (!isset($context['route'])) {
        $home_path = kodety_normalize_public_route_path(
            trim((string) parse_url(home_url('/'), PHP_URL_PATH), '/')
        ) ?? '';
        if ($home_path !== '' && ($request_path === $home_path || str_starts_with($request_path, $home_path . '/'))) {
            $request_path = trim(substr($request_path, strlen($home_path)), '/');
        }
    }
    $manifest_path = kodety_runtime_directory() . '/manifest.json';
    $manifest = is_file($manifest_path) ? json_decode((string) file_get_contents($manifest_path), true) : [];
    $resolved = kodety_localization_request(
        $request_path,
        kodety_localization_settings(),
        is_array($manifest) ? $manifest : []
    );
    $base_route = trim((string) ($resolved['base_route'] ?? ''), '/');
    $is_generated_route = is_array($manifest) && kodety_manifest_relative_for_request($manifest, $base_route) !== '';
    return !empty($resolved['prefixed']) || $is_generated_route ? false : $redirect_url;
}, 10, 2);

function kodety_localization_preferred_locale(array $settings): ?array {
    $locales = kodety_localization_enabled_locales($settings);
    if (!$locales) return null;
    $remembered = isset($_COOKIE['kodety_locale']) ? sanitize_text_field(wp_unslash($_COOKIE['kodety_locale'])) : '';
    if ($remembered !== '') {
        foreach ($locales as $locale) {
            if (strcasecmp($remembered, (string) ($locale['code'] ?? '')) === 0) return $locale;
        }
    }

    $preferences = [];
    foreach (explode(',', (string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '')) as $order => $part) {
        $segments = array_map('trim', explode(';', $part));
        $range = strtolower(str_replace('_', '-', (string) array_shift($segments)));
        if ($range === '' || !preg_match('/^(?:\*|[a-z]{1,8}(?:-[a-z0-9]{1,8})*)$/D', $range)) continue;
        $quality = 1.0;
        foreach ($segments as $parameter) {
            if (!preg_match('/^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/iD', $parameter, $match)) continue;
            $quality = (float) $match[1];
            break;
        }
        $preferences[] = compact('range', 'quality', 'order');
    }
    usort($preferences, static fn(array $left, array $right): int =>
        $right['quality'] <=> $left['quality'] ?: $left['order'] <=> $right['order']
    );
    $is_rejected = static function (array $locale, string $positive_range) use ($preferences): bool {
        $code = strtolower(str_replace('_', '-', (string) ($locale['code'] ?? '')));
        if ($code === '') return true;
        $positive_specificity = $positive_range === '*' ? 0 : substr_count($positive_range, '-') + 1;
        foreach ($preferences as $preference) {
            if (($preference['quality'] ?? 1.0) > 0) continue;
            $rejected = (string) ($preference['range'] ?? '');
            $matches = $rejected === '*'
                || $code === $rejected
                || str_starts_with($code, $rejected . '-');
            if (!$matches) continue;
            $rejected_specificity = $rejected === '*' ? 0 : substr_count($rejected, '-') + 1;
            // A more specific positive range may intentionally opt back into
            // a language rejected only by a broader range. The inverse is not
            // allowed: en-US;q=0,en;q=1 must keep en-US unavailable.
            if ($rejected_specificity >= $positive_specificity) return true;
        }
        return false;
    };
    foreach ($preferences as $preference) {
        if ($preference['quality'] <= 0 || $preference['range'] === '*') continue;
        foreach ($locales as $locale) {
            if (strtolower((string) ($locale['code'] ?? '')) === $preference['range']
                && !$is_rejected($locale, $preference['range'])
            ) return $locale;
        }
        $preferred_language = strtok($preference['range'], '-');
        foreach ($locales as $locale) {
            $code = strtolower((string) ($locale['code'] ?? ''));
            $language = strtolower((string) ($locale['language'] ?? strtok($code, '-')));
            if ($preferred_language !== ''
                && $language === $preferred_language
                && !$is_rejected($locale, $preference['range'])
            ) return $locale;
        }
    }
    return null;
}

function kodety_localization_find_element(DOMDocument $document, string $path): ?DOMElement {
    $element = $document->getElementsByTagName('body')->item(0);
    if (!$element instanceof DOMElement) return null;
    foreach (array_values(array_filter(explode('/', $path), 'strlen')) as $raw_index) {
        $target = (int) $raw_index;
        $children = [];
        foreach ($element->childNodes as $child) if ($child instanceof DOMElement) $children[] = $child;
        $element = $children[$target] ?? null;
        if (!$element instanceof DOMElement) return null;
    }
    return $element;
}

/** Resolve the stable localization selector used by both the browser editor
 * and the published runtime. Path selectors remain supported for projects
 * created before stable data-kodety-l10n-id attributes were introduced. */
function kodety_localization_find_elements_by_key(DOMDocument $document, string $key): array {
    if ($key === 'body') {
        $body = $document->getElementsByTagName('body')->item(0);
        return $body instanceof DOMElement ? [$body] : [];
    }
    if (str_starts_with($key, 'path:')) {
        $element = kodety_localization_find_element($document, substr($key, 5));
        return $element instanceof DOMElement ? [$element] : [];
    }
    $attribute = '';
    $value = '';
    if (str_starts_with($key, 'id:')) {
        $attribute = 'data-kodety-l10n-id';
        $value = trim(substr($key, 3));
    } elseif (str_starts_with($key, 'insertion:')) {
        $attribute = 'data-kodety-locale-insertion';
        $value = trim(substr($key, 10));
    }
    if ($attribute === '' || $value === '') return [];
    $matches = [];
    foreach ((new DOMXPath($document))->query('//*[@' . $attribute . ']') ?: [] as $candidate) {
        if ($candidate instanceof DOMElement && hash_equals($value, $candidate->getAttribute($attribute))) {
            $matches[] = $candidate;
        }
    }
    return $matches;
}

function kodety_localization_find_element_by_key(DOMDocument $document, string $key): ?DOMElement {
    $elements = kodety_localization_find_elements_by_key($document, $key);
    return $elements[0] ?? null;
}

function kodety_localization_entry_key(DOMElement $element, string $path): string {
    $stable = trim($element->getAttribute('data-kodety-l10n-id'));
    return $stable !== '' ? 'id:' . $stable : 'path:' . $path;
}

function kodety_localization_entry_text_is_blank(mixed $value): bool {
    if (!is_string($value)) return true;
    // PHP trim() does not cover all Unicode separators (notably NBSP). Empty
    // direct records must keep the fallback locale instead of blanking it.
    return preg_match('/^[\s\p{Z}]*$/uD', $value) !== 0;
}

function kodety_localization_preserve_text_whitespace(string $authored, string $localized): string {
    preg_match('/^[\s\p{Z}]*/u', $authored, $leading_match);
    preg_match('/[\s\p{Z}]*$/uD', $authored, $trailing_match);
    $value = preg_replace('/^[\s\p{Z}]+|[\s\p{Z}]+$/u', '', $localized);
    return ($leading_match[0] ?? '') . ($value ?? trim($localized)) . ($trailing_match[0] ?? '');
}

function kodety_localization_entry_value(
    array $entries,
    DOMElement $element,
    string $path,
    string $suffix,
    bool &$found
): string {
    $stable_key = kodety_localization_entry_key($element, $path) . $suffix;
    $legacy_key = 'path:' . $path . $suffix;
    foreach (array_unique([$stable_key, $legacy_key]) as $key) {
        if (!array_key_exists($key, $entries)) continue;
        $value = $entries[$key];
        if (kodety_localization_entry_text_is_blank($value)) continue;
        $found = true;
        return (string) $value;
    }
    $found = false;
    return '';
}

function kodety_localization_apply_entries(DOMDocument $document, DOMElement $element, string $path, array $entries): void {
    $ignored = ['script', 'style', 'link', 'meta', 'noscript', 'template'];
    if (in_array(strtolower($element->tagName), $ignored, true)) return;
    $element_children = [];
    foreach ($element->childNodes as $child) if ($child instanceof DOMElement) $element_children[] = $child;
    $has_text = false;
    $localized_text = kodety_localization_entry_value($entries, $element, $path, ':text', $has_text);
    $has_non_text_child = false;
    foreach ($element->childNodes as $child) {
        if (!$child instanceof DOMText) {
            $has_non_text_child = true;
            break;
        }
    }
    if (!$has_non_text_child && $has_text) {
        while ($element->firstChild) $element->removeChild($element->firstChild);
        $element->appendChild($document->createTextNode($localized_text));
    } elseif ($has_non_text_child) {
        $text_ordinal = 0;
        foreach (iterator_to_array($element->childNodes) as $child) {
            if (!$child instanceof DOMText || kodety_localization_entry_text_is_blank((string) $child->nodeValue)) continue;
            $found = false;
            $value = kodety_localization_entry_value(
                $entries,
                $element,
                $path,
                ':text-node:' . $text_ordinal,
                $found
            );
            if ($found) {
                $child->nodeValue = kodety_localization_preserve_text_whitespace(
                    (string) $child->nodeValue,
                    $value
                );
            }
            $text_ordinal++;
        }
    }
    foreach (['alt', 'title', 'placeholder', 'aria-label'] as $attribute) {
        $found = false;
        $value = kodety_localization_entry_value($entries, $element, $path, ':attr:' . $attribute, $found);
        if ($found) $element->setAttribute($attribute, $value);
    }
    foreach ($element_children as $index => $child) kodety_localization_apply_entries($document, $child, $path === '' ? (string) $index : $path . '/' . $index, $entries);
}

/** Parse an inline style without splitting semicolons inside strings, data
 * URLs or CSS functions. Locale overrides are serialized last after legacy
 * CSS priorities have been removed from the project. */
function kodety_localization_parse_style(string $style): array {
    $parts = [];
    $buffer = '';
    $quote = '';
    $escaped = false;
    $depth = 0;
    $length = strlen($style);
    for ($index = 0; $index < $length; $index++) {
        $character = $style[$index];
        if ($escaped) {
            $buffer .= $character;
            $escaped = false;
            continue;
        }
        if ($character === '\\') {
            $buffer .= $character;
            $escaped = true;
            continue;
        }
        if ($quote !== '') {
            $buffer .= $character;
            if ($character === $quote) $quote = '';
            continue;
        }
        if ($character === '"' || $character === "'") {
            $quote = $character;
            $buffer .= $character;
            continue;
        }
        if ($character === '(' || $character === '[') $depth++;
        elseif (($character === ')' || $character === ']') && $depth > 0) $depth--;
        if ($character === ';' && $depth === 0) {
            $parts[] = $buffer;
            $buffer = '';
            continue;
        }
        $buffer .= $character;
    }
    if (trim($buffer) !== '') $parts[] = $buffer;

    $declarations = [];
    foreach ($parts as $part) {
        $colon = strpos($part, ':');
        if ($colon === false) continue;
        $property = strtolower(trim(substr($part, 0, $colon)));
        $value = trim(substr($part, $colon + 1));
        if ($property !== '') $declarations[$property] = $value;
    }
    return $declarations;
}

function kodety_localization_safe_css_property(string $property): bool {
    $property = strtolower(trim($property));
    return (bool) preg_match('/^(?:--[a-z0-9_-]+|[a-z][a-z0-9-]*)$/', $property)
        && !in_array($property, ['behavior', '-moz-binding'], true);
}

function kodety_localization_safe_css_value(string $value): bool {
    return !preg_match('/(?:expression\s*\(|javascript\s*:|vbscript\s*:)/i', $value);
}

/** CSS shorthand relationships shared with the browser editor. An explicit
 * locale edit removes declarations in the same cascade layer that can reset
 * or shadow the property, including legacy prioritized declarations. */
function kodety_localization_css_shorthand_longhands(): array {
    static $map = [
        'padding' => ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
        'margin' => ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
        'gap' => ['row-gap', 'column-gap'],
        'background' => [
            'background-color', 'background-image', 'background-position', 'background-size',
            'background-repeat', 'background-attachment', 'background-clip', 'background-origin',
        ],
        'border' => ['border-width', 'border-style', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left'],
        'border-width' => ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
        'border-style' => ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
        'border-color' => ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
        'border-top' => ['border-top-width', 'border-top-style', 'border-top-color'],
        'border-right' => ['border-right-width', 'border-right-style', 'border-right-color'],
        'border-bottom' => ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
        'border-left' => ['border-left-width', 'border-left-style', 'border-left-color'],
        'border-block' => ['border-block-width', 'border-block-style', 'border-block-color'],
        'border-inline' => ['border-inline-width', 'border-inline-style', 'border-inline-color'],
        'border-radius' => ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
        'outline' => ['outline-width', 'outline-style', 'outline-color'],
        'font' => ['font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant', 'line-height'],
        'flex' => ['flex-grow', 'flex-shrink', 'flex-basis'],
        'flex-flow' => ['flex-direction', 'flex-wrap'],
        'grid' => [
            'grid-template', 'grid-template-rows', 'grid-template-columns', 'grid-auto-flow',
            'grid-auto-rows', 'grid-auto-columns', 'grid-row', 'grid-column',
        ],
        'grid-template' => ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'],
        'grid-row' => ['grid-row-start', 'grid-row-end'],
        'grid-column' => ['grid-column-start', 'grid-column-end'],
        'place-content' => ['align-content', 'justify-content'],
        'place-items' => ['align-items', 'justify-items'],
        'place-self' => ['align-self', 'justify-self'],
        'overflow' => ['overflow-x', 'overflow-y'],
        'inset' => ['top', 'right', 'bottom', 'left'],
        'inset-block' => ['inset-block-start', 'inset-block-end'],
        'inset-inline' => ['inset-inline-start', 'inset-inline-end'],
        'columns' => ['column-width', 'column-count'],
        'column-rule' => ['column-rule-width', 'column-rule-style', 'column-rule-color'],
        'transition' => [
            'transition-property', 'transition-duration', 'transition-timing-function',
            'transition-delay', 'transition-behavior',
        ],
        'animation' => [
            'animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay',
            'animation-iteration-count', 'animation-direction', 'animation-fill-mode',
            'animation-play-state', 'animation-timeline',
        ],
        'text-decoration' => [
            'text-decoration-line', 'text-decoration-color', 'text-decoration-style',
            'text-decoration-thickness',
        ],
        'list-style' => ['list-style-position', 'list-style-image', 'list-style-type'],
    ];
    return $map;
}

function kodety_localization_css_shorthand_descendants(string $property, array &$seen = []): array {
    if (isset($seen[$property])) return $seen;
    $seen[$property] = true;
    foreach (kodety_localization_css_shorthand_longhands()[$property] ?? [] as $child) {
        kodety_localization_css_shorthand_descendants($child, $seen);
    }
    return $seen;
}

function kodety_localization_conflicting_style_properties(string $property): array {
    $property = strtolower(trim($property));
    if ($property === '') return [];
    $conflicts = [$property => true, 'all' => true];
    $descendants = [];
    kodety_localization_css_shorthand_descendants($property, $descendants);
    foreach ($descendants as $name => $_) $conflicts[$name] = true;
    foreach (array_keys(kodety_localization_css_shorthand_longhands()) as $shorthand) {
        $children = [];
        kodety_localization_css_shorthand_descendants($shorthand, $children);
        if (isset($children[$property])) $conflicts[$shorthand] = true;
    }
    return $conflicts;
}

function kodety_localization_apply_styles(DOMElement $element, array $styles): void {
    $declarations = kodety_localization_parse_style($element->getAttribute('style'));
    foreach ($declarations as $property => $value) {
        $declarations[$property] = trim((string) preg_replace('/\s*!\s*important\b/i', '', $value));
    }
    foreach ($styles as $raw_property => $raw_value) {
        $property = strtolower(trim((string) $raw_property));
        if (!kodety_localization_safe_css_property($property)) continue;
        foreach (array_keys(kodety_localization_conflicting_style_properties($property)) as $conflict) {
            unset($declarations[$conflict]);
        }
        if ($raw_value === null || trim((string) $raw_value) === '') {
            continue;
        }
        $value = trim((string) $raw_value);
        if (!kodety_localization_safe_css_value($value)) continue;
        $value = trim((string) preg_replace('/\s*!\s*important\b/i', '', $value));
        if ($value !== '') $declarations[$property] = $value;
    }
    $serialized = implode('; ', array_map(
        static fn(string $property, string $value): string => $property . ': ' . $value,
        array_keys($declarations),
        array_values($declarations)
    ));
    if ($serialized === '') $element->removeAttribute('style');
    else $element->setAttribute('style', $serialized . ';');
}

function kodety_localization_unicode_length(string $value): int {
    if ($value === '') return 0;
    if (!preg_match('//u', $value)) return PHP_INT_MAX;
    $length = preg_match_all('/./us', $value);
    return is_int($length) ? $length : PHP_INT_MAX;
}

function kodety_localization_safe_attribute(string $attribute, mixed $value): bool {
    $attribute = strtolower(trim($attribute));
    if (!preg_match('/^[a-z_:][a-z0-9_.:-]*$/', $attribute)) return false;
    if (str_contains($attribute, ':')
        || $attribute === 'style'
        || $attribute === 'srcdoc'
        || str_starts_with($attribute, 'on')
    ) return false;
    if ($attribute === 'data-kodety-l10n-id'
        || str_starts_with($attribute, 'data-kodety-bind-')
        || str_starts_with($attribute, 'data-kodety-locale-')
    ) return false;
    if ($value !== null && $attribute === 'id') {
        $id = (string) $value;
        if ($id === ''
            || kodety_localization_unicode_length($id) > 200
            || trim($id) !== $id
            || preg_match('/[\x00-\x20\x7F"\'<>=`]/u', $id)
        ) return false;
    }
    if ($value !== null && $attribute === 'class') {
        $class = (string) $value;
        if (kodety_localization_unicode_length($class) > 2000
            || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F"\'<>=`]/u', $class)
        ) return false;
    }
    if ($value !== null && in_array($attribute, ['href', 'src', 'srcset', 'poster', 'action', 'formaction'], true)) {
        $normalized = html_entity_decode(trim((string) $value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        if (preg_match('/(?:^|[\s,])(?:javascript|vbscript)\s*:/i', $normalized)) return false;
        if (preg_match('/^\s*data\s*:/i', $normalized)
            && !in_array($attribute, ['src', 'srcset', 'poster'], true)
        ) return false;
        if (preg_match('/^\s*data\s*:(?!image\/)/i', $normalized)) return false;
    }
    return true;
}

function kodety_localization_id_is_unique(
    DOMDocument $document,
    DOMElement $target,
    string $candidate
): bool {
    foreach ($document->getElementsByTagName('*') as $element) {
        if (!$element instanceof DOMElement || $element === $target) continue;
        if ($element->getAttribute('id') === $candidate) return false;
    }
    return true;
}

/** Replacing any responsive img candidate must neutralize stale candidates.
 * Otherwise <picture>/<source> or a lazy/srcset attribute can keep rendering
 * the source-locale image even though the localized media was saved. */
function kodety_localization_disable_stale_image_candidates(DOMElement $element, array $attributes): void {
    $stale_candidates = ['srcset', 'sizes', 'data-src', 'data-srcset', 'data-lazy-src', 'data-lazy-srcset', 'data-original', 'data-original-src'];
    $all_candidates = ['src', ...$stale_candidates];
    $attribute_names = array_map(
        static fn(mixed $attribute): string => strtolower(trim((string) $attribute)),
        array_keys($attributes)
    );
    if (strtolower($element->tagName) !== 'img'
        || !array_intersect($attribute_names, $all_candidates)
    ) return;
    foreach ($stale_candidates as $attribute) {
        if (!array_key_exists($attribute, $attributes)) $element->removeAttribute($attribute);
    }
    $parent = $element->parentNode;
    while ($parent instanceof DOMElement && strtolower($parent->tagName) !== 'picture') $parent = $parent->parentNode;
    if (!$parent instanceof DOMElement) return;
    foreach ($parent->getElementsByTagName('source') as $source) {
        if (!$source instanceof DOMElement) continue;
        foreach ($all_candidates as $attribute) $source->removeAttribute($attribute);
    }
}

function kodety_localization_override_priority(string $key): int {
    if ($key === 'body' || str_starts_with($key, 'path:')) return 0;
    if (str_starts_with($key, 'id:')) return 1;
    if (str_starts_with($key, 'insertion:')) return 2;
    return 3;
}

function kodety_localization_apply_overrides(
    DOMDocument $document,
    array $overrides,
    bool $after_insertions = false,
    array $applied_keys = []
): array {
    $candidates = [];
    foreach ($overrides as $key => $override) {
        if (!is_string($key) || !is_array($override)) continue;
        $insertion_target = str_starts_with($key, 'insertion:');
        if (!$after_insertions && $insertion_target) continue;
        if ($after_insertions && !$insertion_target && !(str_starts_with($key, 'id:') && !isset($applied_keys[$key]))) continue;
        $elements = kodety_localization_find_elements_by_key($document, $key);
        if (!$elements) continue;
        $candidates[] = [
            'key' => $key,
            'override' => $override,
            'elements' => $elements,
        ];
    }
    usort($candidates, static function (array $left, array $right): int {
        $priority = kodety_localization_override_priority($left['key']) <=> kodety_localization_override_priority($right['key']);
        return $priority !== 0 ? $priority : strcmp($left['key'], $right['key']);
    });

    // Neutralize every responsive source before applying explicit attribute
    // overrides. This keeps an explicit <source> locale override independent of
    // associative-array ordering when an <img src> override shares its picture.
    foreach ($candidates as $candidate) {
        $attributes = is_array($candidate['override']['attributes'] ?? null) ? $candidate['override']['attributes'] : [];
        foreach ($candidate['elements'] as $element) {
            if ($element instanceof DOMElement) kodety_localization_disable_stale_image_candidates($element, $attributes);
        }
    }

    foreach ($candidates as $candidate) {
        $key = $candidate['key'];
        $override = $candidate['override'];
        $attributes = is_array($override['attributes'] ?? null) ? $override['attributes'] : [];
        foreach ($candidate['elements'] as $element) {
            if (!$element instanceof DOMElement) continue;
            foreach ($attributes as $raw_attribute => $value) {
                $attribute = strtolower(trim((string) $raw_attribute));
                if (!kodety_localization_safe_attribute($attribute, $value)) continue;
                if ($value === null) $element->removeAttribute($attribute);
                elseif ($attribute !== 'id'
                    || kodety_localization_id_is_unique($document, $element, (string) $value)
                ) $element->setAttribute($attribute, (string) $value);
            }
            if (array_key_exists('visible', $override)) {
                if ($override['visible'] === false) {
                    $element->setAttribute('hidden', 'hidden');
                    $element->setAttribute('aria-hidden', 'true');
                    kodety_localization_apply_styles($element, ['display' => 'none']);
                } elseif ($override['visible'] === true) {
                    $element->removeAttribute('hidden');
                    $element->removeAttribute('aria-hidden');
                    $styles = kodety_localization_parse_style($element->getAttribute('style'));
                    $display = preg_replace('/!\s*important\s*$/i', '', trim((string) ($styles['display'] ?? '')));
                    if (strcasecmp(trim((string) $display), 'none') === 0) {
                        kodety_localization_apply_styles($element, ['display' => null]);
                    }
                }
            }
            if (is_array($override['styles'] ?? null)) kodety_localization_apply_styles($element, $override['styles']);
        }
        $applied_keys[$key] = true;
    }
    return $applied_keys;
}

/** Import one locale-exclusive fragment while deliberately dropping executable
 * elements and event handlers. Custom Code remains the explicit, audited
 * route for scripts; localized sections are layout/content only. */
function kodety_localization_fragment_nodes(DOMDocument $document, string $html): array {
    if ($html === '') return [];
    $helper = new DOMDocument('1.0', 'UTF-8');
    $previous = libxml_use_internal_errors(true);
    $loaded = $helper->loadHTML(
        '<?xml encoding="utf-8" ?><div data-kodety-localized-fragment="1">' . $html . '</div>',
        LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
    );
    libxml_clear_errors();
    libxml_use_internal_errors($previous);
    if (!$loaded) return [];
    $xpath = new DOMXPath($helper);
    $used_localization_ids = [];
    $used_dom_ids = [];
    foreach ((new DOMXPath($document))->query('//*[@data-kodety-l10n-id]') ?: [] as $existing) {
        if (!$existing instanceof DOMElement) continue;
        $existing_id = trim($existing->getAttribute('data-kodety-l10n-id'));
        if ($existing_id !== '') $used_localization_ids[$existing_id] = true;
    }
    foreach ((new DOMXPath($document))->query('//*[@id]') ?: [] as $existing) {
        if (!$existing instanceof DOMElement) continue;
        $existing_id = $existing->getAttribute('id');
        if ($existing_id !== '') $used_dom_ids[$existing_id] = true;
    }
    foreach (['script', 'base', 'object', 'embed', 'meta', 'link', 'style', 'template'] as $tag) {
        foreach (iterator_to_array($helper->getElementsByTagName($tag)) as $unsafe) $unsafe->parentNode?->removeChild($unsafe);
    }
    foreach ($xpath->query('//*[@*]') ?: [] as $element) {
        if (!$element instanceof DOMElement) continue;
        foreach (iterator_to_array($element->attributes) as $attribute) {
            if (!$attribute instanceof DOMAttr) continue;
            $name = strtolower((string) $attribute->nodeName);
            if (($attribute->prefix ?? '') !== '' || str_contains($name, ':')) {
                $element->removeAttributeNode($attribute);
                continue;
            }
            if ($name === 'data-kodety-l10n-id') {
                $id = trim($attribute->value);
                if (!preg_match('/^[A-Za-z0-9_.:-]{1,200}$/', $id) || isset($used_localization_ids[$id])) {
                    $element->removeAttribute($attribute->name);
                } else {
                    $used_localization_ids[$id] = true;
                }
                continue;
            }
            if ($name === 'id') {
                $id = $attribute->value;
                if (!kodety_localization_safe_attribute($name, $id) || isset($used_dom_ids[$id])) {
                    $element->removeAttribute($attribute->name);
                } else {
                    $used_dom_ids[$id] = true;
                }
                continue;
            }
            if ($name === 'style') {
                if (!kodety_localization_safe_css_value($attribute->value)) {
                    $element->removeAttributeNode($attribute);
                }
                continue;
            }
            // Bindings remain useful in locale-only CMS sections. Every other
            // attribute crosses the same allow/deny boundary as visual locale
            // overrides, including URL schemes, event/srcdoc and length caps.
            if (preg_match('/^data-kodety-bind-[a-z0-9_.-]+$/D', $name)) continue;
            if (!kodety_localization_safe_attribute($name, $attribute->value)) {
                $element->removeAttributeNode($attribute);
            }
        }
    }
    $wrapper = $xpath->query('//div[@data-kodety-localized-fragment]')->item(0);
    if (!$wrapper instanceof DOMElement) return [];
    $nodes = [];
    foreach (iterator_to_array($wrapper->childNodes) as $child) {
        // A top-level text node cannot carry the stable insertion owner used by
        // selection/reset in the editor. Wrap meaningful text in a neutral
        // inline element; formatting whitespace around element roots remains
        // untouched and is not presented as an editable locale section.
        if ($child instanceof DOMText && trim((string) $child->nodeValue) !== '') {
            $text_root = $document->createElement('span');
            $text_root->setAttribute('data-kodety-locale-text-root', '1');
            $text_root->appendChild($document->createTextNode((string) $child->nodeValue));
            $nodes[] = $text_root;
            continue;
        }
        $imported = $document->importNode($child, true);
        if ($imported) $nodes[] = $imported;
    }
    return $nodes;
}

function kodety_localization_apply_insertions(DOMDocument $document, array $insertions): void {
    // Imported/legacy payloads can contain duplicate IDs. Match the browser
    // runtime's deterministic contract: the last value wins while the first
    // occurrence keeps its place in the insertion order.
    $order = [];
    $by_id = [];
    foreach ($insertions as $insertion) {
        if (!is_array($insertion)) continue;
        $id = trim((string) ($insertion['id'] ?? ''));
        if (!preg_match('/^[A-Za-z0-9_.:-]{1,200}$/', $id)) continue;
        if (!array_key_exists($id, $by_id)) $order[] = $id;
        $by_id[$id] = $insertion;
    }
    $pending = [];
    foreach ($order as $id) {
        $insertion = $by_id[$id];
        if (($insertion['enabled'] ?? true) === false || ($insertion['removed'] ?? false) === true) continue;
        $insertion['id'] = $id;
        $pending[] = $insertion;
    }
    $cursor_by_anchor = [];

    // Resolve insertion-to-insertion anchors by retrying only unresolved
    // records. Every successful pass materializes at least one new anchor.
    // Missing anchors and cycles eventually make no progress and are ignored
    // without changing the relative order of any resolvable insertion.
    while ($pending) {
        $next = [];
        $progress = false;
        foreach ($pending as $insertion) {
            $anchor = kodety_localization_find_element_by_key($document, (string) ($insertion['anchor'] ?? 'body'));
            if (!$anchor instanceof DOMElement) {
                $next[] = $insertion;
                continue;
            }
            $position = (string) ($insertion['position'] ?? 'append');
            if (!in_array($position, ['before', 'after', 'prepend', 'append'], true)) $position = 'append';
            $nodes = kodety_localization_fragment_nodes($document, (string) ($insertion['html'] ?? ''));
            // A resolved but empty/unsafe fragment is consumed rather than
            // retried forever; it cannot create an anchor for a dependent.
            if (!$nodes) {
                $progress = true;
                continue;
            }
            // Keep the source fragment order stable. Re-reading nextSibling or
            // firstChild for every node would reverse `after` and `prepend`.
            $cursor_key = (string) ($insertion['anchor'] ?? 'body') . ':' . $position;
            $previous = $cursor_by_anchor[$cursor_key] ?? null;
            $reference = $position === 'after'
                ? ($previous instanceof DOMNode ? $previous->nextSibling : $anchor->nextSibling)
                : ($position === 'prepend'
                    ? ($previous instanceof DOMNode ? $previous->nextSibling : $anchor->firstChild)
                    : $anchor);
            foreach ($nodes as $node) {
                if ($node instanceof DOMElement) {
                    $node->setAttribute('data-kodety-locale-insertion', (string) $insertion['id']);
                }
                if ($position === 'before' && $anchor->parentNode) $anchor->parentNode->insertBefore($node, $reference);
                elseif ($position === 'after' && $anchor->parentNode) $anchor->parentNode->insertBefore($node, $reference);
                elseif ($position === 'prepend') $anchor->insertBefore($node, $reference);
                else $anchor->appendChild($node);
            }
            if ($position === 'after' || $position === 'prepend') {
                $cursor_by_anchor[$cursor_key] = $nodes[count($nodes) - 1];
            }
            $progress = true;
        }
        if (!$progress) break;
        $pending = $next;
    }
}

function kodety_localization_page_route(
    string $html_path,
    string $locale_code,
    array $settings,
    array $manifest = []
): string {
    $source = (string) ($settings['sourceLocale'] ?? 'pt-BR');
    $default = (string) ($settings['defaultLocale'] ?? $source);
    $normalized_html_path = strtolower(trim(str_replace('\\', '/', $html_path), '/'));
    $canonical_routes = kodety_manifest_canonical_routes($manifest);
    $route = $canonical_routes[$normalized_html_path]
        ?? kodety_manifest_public_route_for_path($manifest, $html_path);
    if (!empty($settings['translatePagePaths']) && $locale_code !== $source) {
        $translated = kodety_normalize_public_route_path(
            (string) ($settings['translations'][$locale_code]['pages'][$html_path]['path'] ?? '')
        );
        if (is_string($translated) && $translated !== '') $route = $translated;
    }
    $locale = null;
    foreach (kodety_localization_enabled_locales($settings) as $candidate) if (($candidate['code'] ?? '') === $locale_code) { $locale = $candidate; break; }
    $prefix = $locale_code === $default
        ? ''
        : (kodety_normalize_public_route_path((string) ($locale['slug'] ?? '')) ?? '');
    return trim(($prefix !== '' ? $prefix . '/' : '') . trim((string) $route, '/'), '/');
}

/**
 * Populate every authored language-selector template from the canonical
 * localization settings. The first authored option is cloned so classes and
 * inline styles remain fully editable in the Builder.
 */
function kodety_localization_materialize_selectors(
    DOMDocument $document,
    string $html_path,
    string $locale_code,
    array $settings,
    array $manifest = []
): void {
    $locales = kodety_localization_enabled_locales($settings);
    if (!$locales) return;
    $xpath = new DOMXPath($document);
    $selectors = $xpath->query('//*[@data-kodety-locale-selector or @data-incode-component="locales-list"]');
    if (!$selectors) return;
    $current_locale = $locales[0];
    foreach ($locales as $candidate) {
        if ((string) ($candidate['code'] ?? '') === $locale_code) {
            $current_locale = $candidate;
            break;
        }
    }

    foreach (iterator_to_array($selectors) as $selector) {
        if (!$selector instanceof DOMElement) continue;
        $current = $xpath->query('.//*[@data-kodety-locale-current]', $selector)?->item(0);
        if ($current instanceof DOMElement) {
            $current->textContent = (string) ($current_locale['name'] ?? $current_locale['code'] ?? $locale_code);
        }
        $options = $xpath->query('.//*[@data-kodety-locale-options]', $selector)?->item(0);
        if (!$options instanceof DOMElement) continue;
        $template = $xpath->query('.//*[@data-kodety-locale-option or self::a]', $options)?->item(0);
        while ($options->firstChild) $options->removeChild($options->firstChild);
        foreach ($locales as $candidate) {
            $code = (string) ($candidate['code'] ?? '');
            if ($code === '') continue;
            $option = $template instanceof DOMElement
                ? $template->cloneNode(true)
                : $document->createElement('a');
            if (!$option instanceof DOMElement) continue;
            while ($option->firstChild) $option->removeChild($option->firstChild);
            $option->appendChild($document->createTextNode((string) ($candidate['name'] ?? $code)));
            $option->setAttribute('data-kodety-locale-option', '');
            $option->setAttribute('href', kodety_runtime_public_url(user_trailingslashit(kodety_localization_page_route($html_path, $code, $settings, $manifest))));
            $option->setAttribute('hreflang', $code);
            $option->setAttribute('lang', $code);
            $option->setAttribute('dir', (string) ($candidate['direction'] ?? 'ltr'));
            if ($code === $locale_code) $option->setAttribute('aria-current', 'page');
            else $option->removeAttribute('aria-current');
            $options->appendChild($option);
        }
    }
}

function kodety_localization_merge_overrides(array $fallback, array $direct): array {
    $resolved = $fallback;
    foreach ($direct as $key => $override) {
        if (!is_string($key) || !is_array($override)) continue;
        $previous = is_array($resolved[$key] ?? null) ? $resolved[$key] : [];
        $resolved[$key] = array_merge($previous, $override);
        $resolved[$key]['attributes'] = array_merge(
            is_array($previous['attributes'] ?? null) ? $previous['attributes'] : [],
            is_array($override['attributes'] ?? null) ? $override['attributes'] : []
        );
        $resolved[$key]['styles'] = array_merge(
            is_array($previous['styles'] ?? null) ? $previous['styles'] : [],
            is_array($override['styles'] ?? null) ? $override['styles'] : []
        );
    }
    return $resolved;
}

/** Merge locale-exclusive nodes by stable insertion id. A direct `removed`
 * tombstone suppresses a fragment inherited through the locale fallback. */
function kodety_localization_merge_insertions(array $fallback, array $direct): array {
    $resolved = [];
    $anonymous = 0;
    foreach (array_merge($fallback, $direct) as $insertion) {
        if (!is_array($insertion)) continue;
        $id = trim((string) ($insertion['id'] ?? ''));
        $key = $id !== '' ? $id : '__anonymous_' . $anonymous++;
        if (!isset($resolved[$key])) $resolved[$key] = $insertion;
        else $resolved[$key] = array_merge($resolved[$key], $insertion);
    }
    return array_values(array_filter(
        $resolved,
        static fn(array $insertion): bool => ($insertion['removed'] ?? false) !== true
    ));
}

/** Keep localized CSS references inside the copied public project tree. */
function kodety_localization_stylesheet_path(mixed $candidate): string {
    if (!is_string($candidate)) return '';
    $path = trim($candidate);
    if ($path === '' || strlen($path) > 1024 || str_contains($path, '\\')) return '';
    $path = (string) preg_replace('~^\./+~', '', $path);
    $path = (string) preg_replace('~/+~', '/', $path);
    $decoded = $path;
    $malformed_encoding = false;
    for ($pass = 0; $pass < 2; $pass++) {
        if (preg_match('/%(?![0-9A-Fa-f]{2})/', $decoded)) {
            $malformed_encoding = true;
            break;
        }
        $decoded = rawurldecode($decoded);
    }
    if (
        $path === ''
        || str_starts_with($path, '/')
        || preg_match('/[\x00-\x1F\x7F]/', $path)
        || preg_match('/[\x00-\x1F\x7F]/', $decoded)
        || $malformed_encoding
        || strpbrk($decoded, "\\?#:<>\"'`") !== false
        || preg_match('~(?:^|/)(?:\.|\.\.)(?:/|$)~', $decoded)
        || preg_match('~^(?:\.incode|\.coday)(?:/|$)~i', $decoded)
        || !preg_match('/\.css$/iD', $decoded)
    ) return '';
    return $path;
}

/** @return list<string> Fallback overlays first, direct locale overlay last. */
function kodety_localization_resolved_stylesheets(
    string $html_path,
    string $locale_code,
    array $settings,
    array $visited = []
): array {
    $source = (string) ($settings['sourceLocale'] ?? '');
    if ($locale_code === '' || $locale_code === $source || in_array($locale_code, $visited, true)) return [];
    $visited[] = $locale_code;
    $locale = null;
    foreach (kodety_localization_enabled_locales($settings) as $candidate) {
        if (($candidate['code'] ?? '') === $locale_code) { $locale = $candidate; break; }
    }
    if (!is_array($locale)) return [];
    $fallback_code = (string) ($locale['fallback'] ?? '');
    $resolved = $fallback_code !== '' && $fallback_code !== $source
        ? kodety_localization_resolved_stylesheets($html_path, $fallback_code, $settings, $visited)
        : [];
    $direct = kodety_localization_stylesheet_path(
        $settings['translations'][$locale_code]['pages'][$html_path]['stylesheet'] ?? null
    );
    if ($direct !== '' && !in_array($direct, $resolved, true)) $resolved[] = $direct;
    return $resolved;
}

function kodety_localization_stylesheet_href(string $html_path, string $stylesheet_path): string {
    $stylesheet_path = kodety_localization_stylesheet_path($stylesheet_path);
    if ($stylesheet_path === '') return '';
    $from = array_values(array_filter(explode('/', trim(str_replace('\\', '/', dirname($html_path)), './'))));
    $to = array_values(array_filter(explode('/', $stylesheet_path)));
    while ($from && $to && $from[0] === $to[0]) {
        array_shift($from);
        array_shift($to);
    }
    return implode('/', array_merge(array_fill(0, count($from), '..'), $to)) ?: './';
}

/** Inject localized overlays without constructing a DOM. Raw-text payloads
 * have already been shielded by the caller. */
function kodety_localization_inject_stylesheets_without_dom(
    string $html,
    string $html_path,
    string $locale_code,
    array $settings
): string {
    $marker = 'data-kodety-localized-style';
    $clean = $html;
    foreach (array_reverse(kodety_runtime_link_tag_spans($html, true)) as $link) {
        if (!kodety_runtime_tag_has_attribute($link['tag'], $marker)) continue;
        $clean = substr_replace($clean, '', $link['offset'], $link['length']);
    }
    $links = kodety_runtime_link_tag_spans($clean, true);
    $seen_hrefs = [];
    foreach ($links as $link) {
        $relations = preg_split(
            '/\s+/',
            strtolower(trim((string) kodety_runtime_tag_attribute_value($link['tag'], 'rel')))
        ) ?: [];
        if (!in_array('stylesheet', $relations, true)) continue;
        $href = trim((string) kodety_runtime_tag_attribute_value($link['tag'], 'href'));
        if ($href !== '') $seen_hrefs[$href] = true;
    }
    $markup = '';
    foreach (kodety_localization_resolved_stylesheets($html_path, $locale_code, $settings) as $path) {
        $href = kodety_localization_stylesheet_href($html_path, $path);
        if ($href === '' || isset($seen_hrefs[$href])) continue;
        $seen_hrefs[$href] = true;
        $markup .= '<link rel="stylesheet" href="'
            . htmlspecialchars($href, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8')
            . '" ' . $marker . '="'
            . htmlspecialchars($path, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8')
            . '">';
    }
    if ($markup === '') return $clean;
    // Match the editor bridge: localized overlays are the final authored
    // styles in <head>, after both linked and inline source styles.
    $head_end = stripos($clean, '</head');
    if ($head_end === false) return $clean;
    return substr_replace($clean, $markup, $head_end, 0);
}

function kodety_localization_inject_stylesheets_dom(
    DOMDocument $document,
    DOMElement $head,
    string $html_path,
    string $locale_code,
    array $settings
): void {
    $marker = 'data-kodety-localized-style';
    foreach (iterator_to_array($head->getElementsByTagName('link')) as $link) {
        if ($link instanceof DOMElement && $link->hasAttribute($marker)) $link->parentNode?->removeChild($link);
    }
    $seen_hrefs = [];
    foreach (iterator_to_array($head->childNodes) as $child) {
        if (!$child instanceof DOMElement || strtolower($child->tagName) !== 'link') continue;
        $relations = preg_split('/\s+/', strtolower(trim($child->getAttribute('rel')))) ?: [];
        if (!in_array('stylesheet', $relations, true)) continue;
        $href = trim($child->getAttribute('href'));
        if ($href !== '') $seen_hrefs[$href] = true;
    }
    foreach (kodety_localization_resolved_stylesheets($html_path, $locale_code, $settings) as $path) {
        $href = kodety_localization_stylesheet_href($html_path, $path);
        if ($href === '' || isset($seen_hrefs[$href])) continue;
        $seen_hrefs[$href] = true;
        $link = $document->createElement('link');
        $link->setAttribute('rel', 'stylesheet');
        $link->setAttribute('href', $href);
        $link->setAttribute($marker, $path);
        $head->appendChild($link);
    }
}

function kodety_localization_resolved_translation(string $html_path, string $locale_code, array $settings, array $visited = []): array {
    if (in_array($locale_code, $visited, true)) return [];
    $visited[] = $locale_code;
    $locale = null;
    foreach (kodety_localization_enabled_locales($settings) as $candidate) if (($candidate['code'] ?? '') === $locale_code) { $locale = $candidate; break; }
    $fallback_code = (string) ($locale['fallback'] ?? '');
    $fallback = $fallback_code !== '' && $fallback_code !== ($settings['sourceLocale'] ?? '')
        ? kodety_localization_resolved_translation($html_path, $fallback_code, $settings, $visited)
        : [];
    $direct = (array) ($settings['translations'][$locale_code]['pages'][$html_path] ?? []);
    foreach (['title', 'description'] as $key) {
        if (is_string($direct[$key] ?? null) && trim($direct[$key]) === '') unset($direct[$key]);
    }
    $fallback_entries = array_filter(
        (array) ($fallback['entries'] ?? []),
        static fn(mixed $value): bool => !kodety_localization_entry_text_is_blank($value)
    );
    $direct_entries = array_filter(
        (array) ($direct['entries'] ?? []),
        static fn(mixed $value): bool => !kodety_localization_entry_text_is_blank($value)
    );
    $resolved = array_merge($fallback, $direct);
    $resolved['entries'] = array_merge($fallback_entries, $direct_entries);
    $resolved['overrides'] = kodety_localization_merge_overrides(
        (array) ($fallback['overrides'] ?? []),
        (array) ($direct['overrides'] ?? [])
    );
    $resolved['insertions'] = kodety_localization_merge_insertions(
        (array) ($fallback['insertions'] ?? []),
        (array) ($direct['insertions'] ?? [])
    );
    return $resolved;
}

function kodety_localization_resolved_site_translation(
    string $locale_code,
    array $settings,
    array $visited = []
): array {
    $source = (string) ($settings['sourceLocale'] ?? 'pt-BR');
    if ($locale_code === $source || in_array($locale_code, $visited, true)) return [];
    $visited[] = $locale_code;
    $locale = null;
    foreach (kodety_localization_enabled_locales($settings) as $candidate) {
        if (($candidate['code'] ?? '') === $locale_code) {
            $locale = $candidate;
            break;
        }
    }
    $fallback_code = (string) ($locale['fallback'] ?? '');
    $resolved = $fallback_code !== '' && $fallback_code !== $source
        ? kodety_localization_resolved_site_translation($fallback_code, $settings, $visited)
        : [];
    $direct = (array) ($settings['translations'][$locale_code] ?? []);
    foreach (['siteTitle', 'siteDescription'] as $key) {
        if (is_string($direct[$key] ?? null) && trim($direct[$key]) !== '') {
            $resolved[$key] = $direct[$key];
        }
    }
    return $resolved;
}

/**
 * Metadata-only localization can be applied without constructing a DOM tree.
 * A structural pass remains mandatory for translated content, element
 * overrides/insertions and authored locale selector components.
 */
function kodety_localization_html_requires_dom(
    string $html,
    array $translations,
    array $site_translations
): bool {
    if (!empty($translations['overrides']) || !empty($translations['insertions'])) return true;
    foreach ((array) ($translations['entries'] ?? []) as $key => $value) {
        if (kodety_localization_entry_text_is_blank($value)) continue;
        if (!is_string($key) || !preg_match(
            '/^(?:id:.+|path:(?:\d+(?:\/\d+)*)?):(?:text|text-node:\d+|attr:(?:alt|title|placeholder|aria-label))$/D',
            $key
        )) return true;
    }
    if (!class_exists('WP_HTML_Processor') && preg_match(
        '~\bdata-kodety-locale-selector(?:\s*=|\s|>)|\bdata-incode-component\s*=\s*(["\'])locales-list\1~i',
        $html
    ) === 1) return true;
    return false;
}

/** Apply ordinary localized words without serializing the document. WordPress'
 * token processor records only the requested replacement ranges, leaving every
 * script, interaction marker and surrounding byte exactly as authored. */
function kodety_localization_apply_text_without_dom(
    string $html,
    string $locale_code,
    array $locale,
    array $translations,
    array $site_translations
): ?string {
    $entries = (array) ($translations['entries'] ?? []);
    $localized_title = (string) ($translations['title'] ?? $site_translations['siteTitle'] ?? '');
    $localized_description = (string) ($translations['description'] ?? $site_translations['siteDescription'] ?? '');
    $has_work = $entries !== [] || $localized_title !== '' || $localized_description !== '';
    if (!$has_work) return $html;
    if (!class_exists('WP_HTML_Processor')
        || !is_callable(['WP_HTML_Processor', 'create_full_parser'])
        || !method_exists('WP_HTML_Processor', 'set_modifiable_text')
    ) return null;

    $processor = WP_HTML_Processor::create_full_parser($html);
    if (!$processor instanceof WP_HTML_Processor) return null;
    $states = [];
    $failed = false;
    $description_applied = false;
    $ignored = ['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'];

    while ($processor->next_token()) {
        $type = $processor->get_token_type();
        if ($type === '#tag') {
            if ($processor->is_tag_closer()) continue;
            $tag = strtoupper((string) $processor->get_tag());
            $depth = count($processor->get_breadcrumbs());
            foreach (array_keys($states) as $state_depth) {
                if ($state_depth >= $depth) unset($states[$state_depth]);
            }
            $parent_ignored = !empty($states[$depth - 1]['ignored']);
            $element_ignored = $parent_ignored || in_array($tag, $ignored, true);
            $stable_id = trim((string) ($processor->get_attribute('data-kodety-l10n-id') ?? ''));
            $path = null;
            if ($tag === 'BODY') {
                $path = '';
            } elseif (array_key_exists($depth - 1, $states) && $states[$depth - 1]['path'] !== null) {
                $index = (int) ($states[$depth - 1]['nextElementIndex'] ?? 0);
                $states[$depth - 1]['nextElementIndex'] = $index + 1;
                $parent_path = (string) $states[$depth - 1]['path'];
                $path = $parent_path === '' ? (string) $index : $parent_path . '/' . $index;
            }
            $states[$depth] = [
                'id' => $stable_id,
                'path' => $path,
                'ignored' => $element_ignored,
                'textOrdinal' => 0,
                'nextElementIndex' => 0,
            ];

            if ($tag === 'HTML') {
                $processor->set_attribute('lang', $locale_code);
                $processor->set_attribute('dir', ($locale['direction'] ?? 'ltr') === 'rtl' ? 'rtl' : 'ltr');
            }
            if ($tag === 'TITLE' && $localized_title !== '') {
                if (!$processor->set_modifiable_text($localized_title)) $failed = true;
            }
            if ($tag === 'META'
                && $localized_description !== ''
                && strcasecmp((string) ($processor->get_attribute('name') ?? ''), 'description') === 0
            ) {
                $processor->set_attribute('content', $localized_description);
                $description_applied = true;
            }
            if (($stable_id === '' && $path === null) || $element_ignored) continue;
            foreach (['alt', 'title', 'placeholder', 'aria-label'] as $attribute) {
                $keys = $stable_id !== ''
                    ? ['id:' . $stable_id . ':attr:' . $attribute, 'path:' . (string) $path . ':attr:' . $attribute]
                    : ['path:' . (string) $path . ':attr:' . $attribute];
                foreach (array_unique($keys) as $key) {
                    if (!array_key_exists($key, $entries) || kodety_localization_entry_text_is_blank($entries[$key])) continue;
                    $processor->set_attribute($attribute, (string) $entries[$key]);
                    break;
                }
            }
            continue;
        }
        if ($type !== '#text') continue;
        $text = $processor->get_modifiable_text();
        if (kodety_localization_entry_text_is_blank($text)) continue;
        $depth = count($processor->get_breadcrumbs()) - 1;
        if ($depth < 1 || empty($states[$depth]) || !empty($states[$depth]['ignored'])) continue;
        $stable_id = (string) ($states[$depth]['id'] ?? '');
        $path = $states[$depth]['path'] ?? null;
        if ($stable_id === '' && $path === null) continue;
        $ordinal = (int) ($states[$depth]['textOrdinal'] ?? 0);
        $states[$depth]['textOrdinal'] = $ordinal + 1;
        $prefixes = $stable_id !== ''
            ? ['id:' . $stable_id, 'path:' . (string) $path]
            : ['path:' . (string) $path];
        $key = '';
        foreach (array_unique($prefixes) as $prefix) {
            $node_key = $prefix . ':text-node:' . $ordinal;
            $text_key = $prefix . ':text';
            if (array_key_exists($node_key, $entries) && !kodety_localization_entry_text_is_blank($entries[$node_key])) {
                $key = $node_key;
                break;
            }
            if ($ordinal === 0 && array_key_exists($text_key, $entries) && !kodety_localization_entry_text_is_blank($entries[$text_key])) {
                $key = $text_key;
                break;
            }
        }
        if ($key === '') continue;
        if (!$processor->set_modifiable_text(kodety_localization_preserve_text_whitespace(
            $text,
            (string) $entries[$key]
        ))) $failed = true;
    }
    if ($failed || $processor->get_last_error() !== null) return null;
    $updated = $processor->get_updated_html();
    if (!is_string($updated)) return null;
    if ($localized_description !== '' && !$description_applied) {
        $meta = '<meta name="description" content="'
            . htmlspecialchars($localized_description, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8')
            . '">';
        $head_end = stripos($updated, '</head');
        if ($head_end !== false) $updated = substr_replace($updated, $meta, $head_end, 0);
    }
    return $updated;
}

/**
 * Apply lang/dir and alternate links through bounded tag rewrites. Script and
 * style payloads are shielded first so authored strings such as "</head>" are
 * never mistaken for document structure.
 */
function kodety_render_localization_metadata_without_dom(
    string $html,
    string $html_path,
    string $locale_code,
    array $settings,
    array $manifest = []
): ?string {
    $locales = kodety_localization_enabled_locales($settings);
    if (!$locales) return $html;
    $locale = null;
    foreach ($locales as $candidate) {
        if (($candidate['code'] ?? '') === $locale_code) {
            $locale = $candidate;
            break;
        }
    }
    [$protected, $raw_text_payloads] = kodety_protect_runtime_raw_text_payloads($html);
    $protected = preg_replace_callback(
        '~<html\b[^>]*>~i',
        static function (array $match) use ($locale_code, $locale): string {
            $tag = preg_replace(
                '~\s+(?:lang|dir)\s*=\s*(?:"[^"]*"|\'[^\']*\'|[^\s>]+)~i',
                '',
                $match[0]
            );
            if (!is_string($tag) || !str_ends_with($tag, '>')) return $match[0];
            return rtrim(substr($tag, 0, -1))
                . ' lang="' . esc_attr($locale_code) . '"'
                . ' dir="' . esc_attr((string) ($locale['direction'] ?? 'ltr')) . '">';
        },
        $protected,
        1,
        $root_count
    );
    if (!is_string($protected) || $root_count !== 1) return null;
    $protected = kodety_localization_inject_stylesheets_without_dom(
        $protected,
        $html_path,
        $locale_code,
        $settings
    );
    $alternate_links = '';
    foreach ($locales as $candidate) {
        $code = (string) ($candidate['code'] ?? '');
        if ($code === '') continue;
        $alternate_links .= '<link rel="alternate" hreflang="' . esc_attr($code) . '" href="'
            . esc_attr(kodety_runtime_public_url(user_trailingslashit(kodety_localization_page_route($html_path, $code, $settings, $manifest))))
            . '">';
    }
    $default_locale = (string) ($settings['defaultLocale'] ?? $settings['sourceLocale'] ?? '');
    $alternate_links .= '<link rel="alternate" hreflang="x-default" href="'
        . esc_attr(kodety_runtime_public_url(user_trailingslashit(kodety_localization_page_route($html_path, $default_locale, $settings, $manifest))))
        . '">';
    $protected = preg_replace(
        '~</head\s*>~i',
        $alternate_links . '$0',
        $protected,
        1,
        $head_count
    );
    if (!is_string($protected) || $head_count !== 1) return null;
    return kodety_restore_runtime_raw_text_payloads($protected, $raw_text_payloads);
}

function kodety_render_localized_html(
    string $html,
    string $html_path,
    string $locale_code,
    array $settings,
    array $manifest = []
): string {
    if (!$settings['locales']) return $html;
    // The authored/source locale is immutable. Corrupt or legacy metadata may
    // still contain a source-locale payload, but it must never mutate the base
    // HTML at publication time. Locale metadata such as lang/dir/hreflang is
    // still generated below.
    $is_source_locale = hash_equals((string) ($settings['sourceLocale'] ?? 'pt-BR'), $locale_code);
    $locale_translations = $is_source_locale
        ? []
        : kodety_localization_resolved_site_translation($locale_code, $settings);
    $translations = $is_source_locale
        ? []
        : kodety_localization_resolved_translation($html_path, $locale_code, $settings);
    if (!kodety_localization_html_requires_dom($html, $translations, $locale_translations)) {
        $locale = [];
        foreach (kodety_localization_enabled_locales($settings) as $candidate) {
            if (($candidate['code'] ?? '') === $locale_code) {
                $locale = $candidate;
                break;
            }
        }
        $text_only = kodety_localization_apply_text_without_dom(
            $html,
            $locale_code,
            $locale,
            $translations,
            $locale_translations
        );
        if (is_string($text_only)) {
            $metadata_only = kodety_render_localization_metadata_without_dom(
                $text_only,
                $html_path,
                $locale_code,
                $settings,
                $manifest
            );
            if (is_string($metadata_only)) return $metadata_only;
        }
    }
    if (!class_exists('DOMDocument') || !class_exists('DOMElement')) {
        // Hosts without ext-dom must keep serving the authored page. Metadata
        // that can be applied losslessly without a DOM still gets a chance;
        // structural translations degrade gracefully instead of fatalizing the
        // complete public site.
        $metadata_only = kodety_render_localization_metadata_without_dom(
            $html,
            $html_path,
            $locale_code,
            $settings,
            $manifest
        );
        return is_string($metadata_only) ? $metadata_only : $html;
    }
    [$dom_html, $raw_text_payloads] = kodety_protect_runtime_raw_text_payloads($html);
    $document = new DOMDocument('1.0', 'UTF-8');
    $previous = libxml_use_internal_errors(true);
    $document->loadHTML('<?xml encoding="utf-8" ?>' . $dom_html, LIBXML_HTML_NODEFDTD);
    libxml_clear_errors(); libxml_use_internal_errors($previous);
    $root = $document->documentElement;
    if (!$root instanceof DOMElement) return $html;
    $locale = null;
    foreach (kodety_localization_enabled_locales($settings) as $candidate) if (($candidate['code'] ?? '') === $locale_code) { $locale = $candidate; break; }
    $root->setAttribute('lang', $locale_code);
    $root->setAttribute('dir', (string) ($locale['direction'] ?? 'ltr'));
    $body = $document->getElementsByTagName('body')->item(0);
    if ($body instanceof DOMElement) {
        // Path-based legacy entries must resolve before insertions can shift
        // sibling indexes. Stable-id overrides are then applied to the same
        // source tree, followed by locale-exclusive sections.
        kodety_localization_apply_entries($document, $body, '', (array) ($translations['entries'] ?? []));
        $applied_override_keys = kodety_localization_apply_overrides(
            $document,
            (array) ($translations['overrides'] ?? [])
        );
        kodety_localization_apply_insertions($document, (array) ($translations['insertions'] ?? []));
        kodety_localization_apply_overrides(
            $document,
            (array) ($translations['overrides'] ?? []),
            true,
            $applied_override_keys
        );
        kodety_localization_materialize_selectors($document, $html_path, $locale_code, $settings, $manifest);
    }
    $localized_title = (string) ($translations['title'] ?? $locale_translations['siteTitle'] ?? '');
    if ($localized_title !== '') {
        $title = $document->getElementsByTagName('title')->item(0);
        if ($title) $title->textContent = $localized_title;
    }
    $localized_description = (string) ($translations['description'] ?? $locale_translations['siteDescription'] ?? '');
    if ($localized_description !== '') {
        $xpath = new DOMXPath($document);
        $meta = $xpath->query('//meta[@name="description"]')->item(0);
        if (!$meta instanceof DOMElement) { $meta = $document->createElement('meta'); $meta->setAttribute('name', 'description'); $document->getElementsByTagName('head')->item(0)?->appendChild($meta); }
        $meta->setAttribute('content', $localized_description);
    }
    $head = $document->getElementsByTagName('head')->item(0);
    if ($head instanceof DOMElement) {
        kodety_localization_inject_stylesheets_dom(
            $document,
            $head,
            $html_path,
            $locale_code,
            $settings
        );
        foreach (kodety_localization_enabled_locales($settings) as $candidate) {
            $code = (string) $candidate['code'];
            $link = $document->createElement('link');
            $link->setAttribute('rel', 'alternate');
            $link->setAttribute('hreflang', $code);
            $link->setAttribute('href', kodety_runtime_public_url(user_trailingslashit(kodety_localization_page_route($html_path, $code, $settings, $manifest))));
            $head->appendChild($link);
        }
        $default = $document->createElement('link');
        $default->setAttribute('rel', 'alternate'); $default->setAttribute('hreflang', 'x-default');
        $default_locale = (string) ($settings['defaultLocale'] ?? $settings['sourceLocale']);
        $default->setAttribute('href', kodety_runtime_public_url(user_trailingslashit(kodety_localization_page_route($html_path, $default_locale, $settings, $manifest))));
        $head->appendChild($default);
    }
    $result = kodety_save_runtime_html($document);
    return is_string($result)
        ? kodety_cleanup_runtime_html(
            kodety_restore_runtime_raw_text_payloads($result, $raw_text_payloads)
        )
        : $html;
}

/**
 * Kodety-native components use one delegated runtime per page. Keeping the
 * behavior out of authored component markup preserves stable Builder paths
 * and avoids duplicating scripts when several lightboxes are inserted.
 */
function kodety_inject_native_components_runtime(string $html): string {
    $current_runtime = preg_match('/<script\b(?=[^>]*\bdata-kodety-native-components-runtime\s*=\s*(["\'])2\1)[^>]*>/i', $html) === 1;
    $current_style = preg_match('/<style\b(?=[^>]*\bdata-kodety-native-components-style\s*=\s*(["\'])2\1)[^>]*>/i', $html) === 1;
    if ($current_runtime && $current_style) return $html;
    if (
        !str_contains($html, 'data-kodety-lightbox')
        && !str_contains($html, 'data-kodety-locale-selector')
        && !str_contains($html, 'data-kodety-overlay')
        && !str_contains($html, 'data-kodety-native-components-runtime')
    ) return $html;
    $html = (string) preg_replace(
        '/<script\b(?=[^>]*\bdata-kodety-native-components-runtime(?:\s*=|\s|>))[^>]*>[\s\S]*?<\/script\s*>/i',
        '',
        $html
    );
    $html = (string) preg_replace(
        '/<style\b(?=[^>]*\bdata-kodety-native-components-style(?:\s*=|\s|>))[^>]*>[\s\S]*?<\/style\s*>/i',
        '',
        $html
    );
    $style = <<<'HTML'
<style data-kodety-native-components-style="2">
[data-kodety-overlay]:not([data-kodety-overlay-ready="true"]) [data-kodety-overlay-surface],
[data-kodety-overlay][data-kodety-overlay-surface]:not([data-kodety-overlay-ready="true"]),
[data-kodety-overlay]:not([data-kodety-overlay-ready="true"]) [data-kodety-overlay-backdrop],
[data-kodety-overlay][data-kodety-overlay-backdrop]:not([data-kodety-overlay-ready="true"]),
[data-kodety-overlay]:not([data-state="open"]) [data-kodety-overlay-surface],
[data-kodety-overlay][data-kodety-overlay-surface]:not([data-state="open"]),
[data-kodety-overlay]:not([data-state="open"]) [data-kodety-overlay-backdrop],
[data-kodety-overlay][data-kodety-overlay-backdrop]:not([data-state="open"]),
[data-kodety-overlay] [hidden],
[data-kodety-overlay][hidden] {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
</style>
HTML;
    if (stripos($html, '</head>') !== false) {
        $html = (string) preg_replace('/<\/head>/i', $style . '</head>', $html, 1);
    } elseif (preg_match('/<html\b[^>]*>/i', $html) === 1) {
        $html = (string) preg_replace('/<html\b[^>]*>/i', '$0<head>' . $style . '</head>', $html, 1);
    } elseif (preg_match('/<!doctype\b[^>]*>/i', $html) === 1) {
        $html = (string) preg_replace('/<!doctype\b[^>]*>/i', '$0' . $style, $html, 1);
    } elseif (preg_match('/<body\b[^>]*>/i', $html) === 1) {
        $html = (string) preg_replace('/<body\b[^>]*>/i', $style . '$0', $html, 1);
    } else {
        $html = $style . $html;
    }
    $runtime = <<<'HTML'
<script data-kodety-native-components-runtime="2">
(() => {
  if (window.__KODETY_NATIVE_COMPONENTS_VERSION__ === 2 && window.KodetyOverlays?.refresh) {
    window.KodetyOverlays.refresh();
    return;
  }
  window.__KODETY_NATIVE_COMPONENTS__ = true;
  window.__KODETY_NATIVE_COMPONENTS_VERSION__ = 2;
  const OVERLAY_ROOT_SELECTOR = '[data-kodety-overlay]';
  const OVERLAY_SURFACE_SELECTOR = '[data-kodety-overlay-surface]';
  const OVERLAY_BACKDROP_SELECTOR = '[data-kodety-overlay-backdrop]';
  const OVERLAY_CONTROL_SELECTOR = '[data-kodety-overlay-trigger], [data-kodety-overlay-open], [data-kodety-overlay-toggle]';
  const OVERLAY_ACTION_SELECTOR = '[data-kodety-overlay-close], [data-kodety-overlay-open], [data-kodety-overlay-toggle], [data-kodety-overlay-trigger], [data-kodety-overlay-backdrop]';
  const overlayRoots = () => Array.from(document.querySelectorAll(OVERLAY_ROOT_SELECTOR));
  const openOverlays = [];
  const initializedOverlays = new WeakSet();
  const initializedSurfaces = new WeakMap();
  const initializedBackdrops = new WeakMap();
  const initializedDialogSurfaces = new WeakSet();
  const dialogOwners = new WeakMap();
  const tooltipTriggers = new WeakSet();
  const tooltipSurfaces = new WeakSet();
  const tooltipTimers = new WeakMap();
  const clearTooltipTimer = root => {
    const timerState = tooltipTimers.get(root);
    if (!timerState) return;
    clearTimeout(timerState.value);
    timerState.value = 0;
  };
  const previousFocus = new WeakMap();
  const topLayerRestores = new WeakMap();
  const positionRestores = new WeakMap();
  const scrollLockedRoots = new WeakSet();
  let scrollLocks = 0;
  let savedOverflow = '';
  const nearestOverlayRoot = element => element?.closest?.(OVERLAY_ROOT_SELECTOR) || null;
  const ownedOverlayPart = (root, selector) => root && Array.from(root.querySelectorAll(selector)).find(node => nearestOverlayRoot(node) === root) || null;
  const overlaySurface = root => root && (root.matches(OVERLAY_SURFACE_SELECTOR)
    ? root
    : ownedOverlayPart(root, OVERLAY_SURFACE_SELECTOR) || (!root.querySelector(OVERLAY_CONTROL_SELECTOR + ', ' + OVERLAY_BACKDROP_SELECTOR) ? root : null));
  const overlayTokens = control => [
    'data-kodety-overlay-target',
    'data-kodety-overlay-toggle',
    'data-kodety-overlay-open',
    'data-kodety-overlay-trigger',
    'data-kodety-overlay-close',
    'aria-controls',
  ].flatMap(name => {
    const value = control?.getAttribute?.(name) || '';
    return value && !['true', 'false'].includes(value.trim().toLowerCase())
      ? value.trim().split(/\s+/).map(token => token.replace(/^#/, '')).filter(Boolean)
      : [];
  });
  const overlayRootForToken = rawToken => {
    const token = String(rawToken || '').replace(/^#/, '').trim();
    if (!token) return null;
    for (const root of overlayRoots()) {
      const surface = overlaySurface(root);
      if (root.id === token || root.getAttribute('data-kodety-overlay') === token || surface?.id === token) return root;
    }
    return nearestOverlayRoot(document.getElementById(token));
  };
  const resolveOverlay = control => {
    for (const token of overlayTokens(control)) {
      const root = overlayRootForToken(token);
      if (root) return root;
    }
    return nearestOverlayRoot(control);
  };
  const overlayControls = root => Array.from(document.querySelectorAll(OVERLAY_CONTROL_SELECTOR)).filter(control => nearestOverlayRoot(control) === root || resolveOverlay(control) === root);
  const showOverlayTopLayer = (element, zIndex) => {
    if (!(element instanceof HTMLElement)) return;
    if (!topLayerRestores.has(element)) topLayerRestores.set(element, {
      popover: element.getAttribute('popover'),
      zIndex: element.style.getPropertyValue('z-index'),
      zIndexPriority: element.style.getPropertyPriority('z-index'),
    });
    element.style.setProperty('z-index', String(zIndex));
    if (element instanceof HTMLDialogElement || typeof element.showPopover !== 'function') return;
    element.setAttribute('popover', 'manual');
    try { element.showPopover(); } catch (_) {}
  };
  const hideOverlayTopLayer = element => {
    if (!(element instanceof HTMLElement)) return;
    if (!(element instanceof HTMLDialogElement) && typeof element.hidePopover === 'function') {
      try { element.hidePopover(); } catch (_) {}
    }
    const restore = topLayerRestores.get(element);
    if (!restore) return;
    if (restore.popover === null) element.removeAttribute('popover');
    else element.setAttribute('popover', restore.popover);
    if (restore.zIndex) element.style.setProperty('z-index', restore.zIndex, restore.zIndexPriority);
    else element.style.removeProperty('z-index');
    topLayerRestores.delete(element);
  };
  const isModalOverlay = root => {
    const kind = root?.getAttribute('data-kodety-overlay') || '';
    const configured = root?.getAttribute('data-kodety-overlay-modal');
    if (configured !== null && configured !== undefined) return !['0', 'false', 'no', 'off'].includes(configured.trim().toLowerCase());
    return ['modal', 'drawer', 'checkout', 'cart'].includes(kind);
  };
  const liveOverlayParts = root => ({
    surface: overlaySurface(root),
    backdrop: root && (root.matches(OVERLAY_BACKDROP_SELECTOR) ? root : ownedOverlayPart(root, OVERLAY_BACKDROP_SELECTOR)),
    triggers: root ? overlayControls(root) : [],
  });
  const cachedOverlayPartForRoot = (root, part) => {
    if (!(root instanceof Element) || !(part instanceof HTMLElement)) return null;
    if (part === root) return part;
    if (!root.contains(part)) return null;
    const owner = nearestOverlayRoot(part);
    return !owner || owner === root ? part : null;
  };
  const overlayParts = root => {
    const live = liveOverlayParts(root);
    return {
      surface: live.surface || cachedOverlayPartForRoot(root, initializedSurfaces.get(root)),
      backdrop: live.backdrop || cachedOverlayPartForRoot(root, initializedBackdrops.get(root)),
      triggers: live.triggers,
    };
  };
  const findOverlayRoot = target => {
    if (target instanceof Element) {
      if (target.matches(OVERLAY_ROOT_SELECTOR) || initializedOverlays.has(target) || openOverlays.includes(target)) return target;
      return resolveOverlay(target) || nearestOverlayRoot(target);
    }
    if (typeof target !== 'string' || !target) return null;
    const byToken = overlayRootForToken(target);
    if (byToken) return byToken;
    try {
      const selected = document.querySelector(target);
      if (selected) return selected.matches(OVERLAY_ROOT_SELECTOR) ? selected : nearestOverlayRoot(selected);
    } catch (_) {}
    return null;
  };
  const lockScroll = () => {
    if (scrollLocks++ > 0) return;
    savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
  };
  const unlockScroll = () => {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.documentElement.style.overflow = savedOverflow;
  };
  const positionOverlay = root => {
    if (!root || root.dataset.state !== 'open') return;
    const kind = root.getAttribute('data-kodety-overlay') || '';
    const mode = (root.getAttribute('data-kodety-overlay-mode') || root.getAttribute('data-kodety-overlay-position') || '').trim().toLowerCase();
    if (mode ? mode !== 'anchored' : !['popover', 'tooltip', 'menu'].includes(kind)) return;
    const { surface, triggers } = overlayParts(root);
    const trigger = triggers.find(item => item.getAttribute('aria-expanded') === 'true') || triggers[0];
    if (!(surface instanceof HTMLElement) || !(trigger instanceof HTMLElement)) return;
    if (!positionRestores.has(surface)) positionRestores.set(surface, Object.fromEntries(
      ['position', 'inset', 'top', 'right', 'bottom', 'left', 'margin', 'transform']
        .map(property => [property, surface.style.getPropertyValue(property)]),
    ));
    surface.style.position = 'fixed';
    surface.style.inset = 'auto';
    surface.style.right = 'auto';
    surface.style.bottom = 'auto';
    surface.style.transform = 'none';
    const gap = 8;
    const margin = 8;
    const anchor = trigger.getBoundingClientRect();
    const box = surface.getBoundingClientRect();
    const requested = root.getAttribute('data-kodety-overlay-placement') || (kind === 'tooltip' ? 'top' : 'bottom-start');
    let placement = requested;
    const room = {
      top: anchor.top - margin,
      bottom: innerHeight - anchor.bottom - margin,
      left: anchor.left - margin,
      right: innerWidth - anchor.right - margin,
    };
    if (placement.startsWith('bottom') && room.bottom < box.height + gap && room.top > room.bottom) placement = placement.replace('bottom', 'top');
    if (placement.startsWith('top') && room.top < box.height + gap && room.bottom > room.top) placement = placement.replace('top', 'bottom');
    if (placement.startsWith('right') && room.right < box.width + gap && room.left > room.right) placement = placement.replace('right', 'left');
    if (placement.startsWith('left') && room.left < box.width + gap && room.right > room.left) placement = placement.replace('left', 'right');
    const side = placement.split('-')[0];
    const alignment = placement.split('-')[1] || 'center';
    let top = anchor.top + (anchor.height - box.height) / 2;
    let left = anchor.left + (anchor.width - box.width) / 2;
    if (side === 'top') top = anchor.top - box.height - gap;
    else if (side === 'bottom') top = anchor.bottom + gap;
    else if (side === 'left') left = anchor.left - box.width - gap;
    else if (side === 'right') left = anchor.right + gap;
    if (side === 'top' || side === 'bottom') {
      if (alignment === 'start') left = anchor.left;
      else if (alignment === 'end') left = anchor.right - box.width;
    } else {
      if (alignment === 'start') top = anchor.top;
      else if (alignment === 'end') top = anchor.bottom - box.height;
    }
    surface.style.top = `${Math.max(margin, Math.min(innerHeight - box.height - margin, top))}px`;
    surface.style.left = `${Math.max(margin, Math.min(innerWidth - box.width - margin, left))}px`;
    root.setAttribute('data-kodety-overlay-resolved-placement', placement);
  };
  const restoreOverlayPosition = surface => {
    if (!(surface instanceof HTMLElement)) return;
    const restore = positionRestores.get(surface);
    if (!restore) return;
    Object.entries(restore).forEach(([property, value]) => {
      if (value) surface.style.setProperty(property, value);
      else surface.style.removeProperty(property);
    });
    positionRestores.delete(surface);
  };
  const setOverlayPartOpen = (element, zIndex) => {
    if (!(element instanceof HTMLElement)) return;
    element.hidden = false;
    element.removeAttribute('inert');
    element.removeAttribute('data-html-editor-overlay-forced-open');
    element.setAttribute('aria-hidden', 'false');
    element.setAttribute('data-state', 'open');
    showOverlayTopLayer(element, zIndex);
  };
  const setOverlayPartClosed = element => {
    if (!(element instanceof HTMLElement)) return;
    if (element instanceof HTMLDialogElement) {
      if (element.open) {
        try { element.close(); } catch (_) { element.removeAttribute('open'); }
      } else {
        element.removeAttribute('open');
      }
    }
    hideOverlayTopLayer(element);
    restoreOverlayPosition(element);
    element.hidden = true;
    element.setAttribute('inert', '');
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('data-state', 'closed');
    element.removeAttribute('data-html-editor-overlay-forced-open');
  };
  const setOverlayPartsOpen = (root, overlay) => {
    const { surface, backdrop, triggers } = overlay;
    setOverlayPartOpen(backdrop, 2147483646);
    setOverlayPartOpen(surface, 2147483647);
    if (surface instanceof HTMLDialogElement && !surface.open) {
      try { isModalOverlay(root) ? surface.showModal() : surface.show(); }
      catch (_) { surface.setAttribute('open', ''); }
    }
    triggers.forEach(item => {
      item.setAttribute('aria-expanded', 'true');
      item.setAttribute('data-state', 'open');
    });
  };
  const openOverlay = (target, opener) => {
    const root = findOverlayRoot(target);
    if (!(root instanceof HTMLElement) || !root.isConnected || !root.matches(OVERLAY_ROOT_SELECTOR)) return false;
    clearTooltipTimer(root);
    initializeOverlayRoot(root);
    if (root.getAttribute('data-kodety-overlay') === 'checkout'
      && root.getAttribute('data-kodefy-checkout-ready') !== 'true') return false;
    const { surface, backdrop, triggers } = overlayParts(root);
    if (!(surface instanceof HTMLElement)) return false;
    if (openOverlays.includes(root)) {
      root.dataset.state = 'open';
      root.setAttribute('data-kodety-overlay-ready', 'true');
      setOverlayPartsOpen(root, { surface, backdrop, triggers });
      positionOverlay(root);
      return true;
    }
    previousFocus.set(root, opener instanceof HTMLElement ? opener : document.activeElement);
    root.dataset.state = 'open';
    root.setAttribute('data-kodety-overlay-ready', 'true');
    root.removeAttribute('data-html-editor-overlay-forced-open');
    setOverlayPartsOpen(root, { surface, backdrop, triggers });
    openOverlays.push(root);
    if (isModalOverlay(root) && root.getAttribute('data-kodety-overlay-lock-scroll') !== 'false') {
      lockScroll();
      scrollLockedRoots.add(root);
    }
    positionOverlay(root);
    if (isModalOverlay(root) && root.getAttribute('data-kodety-overlay-autofocus') !== 'false') {
      requestAnimationFrame(() => (surface.querySelector('[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]') || surface).focus?.({ preventScroll: true }));
    }
    root.dispatchEvent(new CustomEvent('kodety:overlay-open', { bubbles: true, detail: { root, surface, opener } }));
    return true;
  };
  const closeOverlay = (target, options = {}) => {
    const root = findOverlayRoot(target);
    if (!(root instanceof Element)) return false;
    clearTooltipTimer(root);
    const { surface, backdrop, triggers } = overlayParts(root);
    const openIndex = openOverlays.lastIndexOf(root);
    const wasOpen = openIndex >= 0;
    while (openOverlays.includes(root)) openOverlays.splice(openOverlays.lastIndexOf(root), 1);
    root.dataset.state = 'closed';
    root.removeAttribute('data-html-editor-overlay-forced-open');
    setOverlayPartClosed(surface);
    setOverlayPartClosed(backdrop);
    triggers.forEach(item => {
      item.setAttribute('aria-expanded', 'false');
      item.setAttribute('data-state', 'closed');
    });
    if (wasOpen && scrollLockedRoots.has(root)) unlockScroll();
    scrollLockedRoots.delete(root);
    const focus = previousFocus.get(root);
    previousFocus.delete(root);
    if (wasOpen
      && root.getAttribute('data-kodety-overlay') !== 'tooltip'
      && options.restoreFocus !== false
      && focus instanceof HTMLElement
      && focus.isConnected) focus.focus({ preventScroll: true });
    if (wasOpen && options.silent !== true) root.dispatchEvent(new CustomEvent('kodety:overlay-close', { bubbles: true, detail: { root, surface } }));
    return true;
  };
  const toggleOverlay = (target, opener) => {
    const root = findOverlayRoot(target);
    return root && openOverlays.includes(root) ? closeOverlay(root) : openOverlay(root, opener);
  };
  const installOverlayDialogHandlers = (root, surface) => {
    if (!(surface instanceof HTMLDialogElement)) return;
    dialogOwners.set(surface, root);
    if (initializedDialogSurfaces.has(surface)) return;
    initializedDialogSurfaces.add(surface);
    const syncNativeClose = () => {
      const owner = dialogOwners.get(surface);
      if (owner && openOverlays.includes(owner) && !surface.open) closeOverlay(owner);
    };
    surface.addEventListener('close', syncNativeClose);
    surface.addEventListener('cancel', () => queueMicrotask(syncNativeClose));
  };
  const forgetInitializedOverlayParts = root => {
    const surface = initializedSurfaces.get(root);
    if (surface && dialogOwners.get(surface) === root) dialogOwners.delete(surface);
    initializedSurfaces.delete(root);
    initializedBackdrops.delete(root);
    initializedOverlays.delete(root);
  };
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const overlayAction = target.closest(OVERLAY_ACTION_SELECTOR);
    if (overlayAction) {
      const bareKodefyCheckout = overlayAction.hasAttribute('data-kodefy-checkout')
        && overlayAction.hasAttribute('data-kodety-overlay-trigger')
        && !overlayAction.hasAttribute('data-kodety-overlay-open')
        && !overlayAction.hasAttribute('data-kodety-overlay-toggle')
        && !overlayAction.hasAttribute('data-kodety-overlay-close');
      if (bareKodefyCheckout) return;
      const root = resolveOverlay(overlayAction);
      if (root) {
        event.preventDefault();
        if (overlayAction.hasAttribute('data-kodety-overlay-close') || overlayAction.matches(OVERLAY_BACKDROP_SELECTOR)) closeOverlay(root);
        else if (overlayAction.hasAttribute('data-kodety-overlay-toggle') || overlayAction.hasAttribute('data-kodety-overlay-trigger') && !overlayAction.hasAttribute('data-kodety-overlay-open')) toggleOverlay(root, overlayAction);
        else openOverlay(root, overlayAction);
        return;
      }
    }
    const opener = target.closest('[data-kodety-lightbox-open]');
    if (opener) {
      event.preventDefault();
      const root = opener.closest('[data-kodety-lightbox]');
      const dialog = root?.querySelector('[data-kodety-lightbox-dialog]');
      const thumbnail = root?.querySelector('[data-kodety-lightbox-thumb]');
      const fullImage = dialog?.querySelector('[data-kodety-lightbox-image]');
      const fullSource = root?.getAttribute('data-kodety-lightbox-src')
        || thumbnail?.currentSrc
        || thumbnail?.getAttribute('src')
        || '';
      if (fullImage instanceof HTMLImageElement) {
        if (fullSource) fullImage.src = fullSource;
        else fullImage.removeAttribute('src');
        fullImage.alt = thumbnail?.getAttribute('alt') || '';
      }
      if (dialog instanceof HTMLDialogElement && !dialog.open) {
        dialog.showModal();
        dialog.querySelector('[data-kodety-lightbox-close]:last-child')?.focus?.();
      }
      return;
    }
    const closer = target.closest('[data-kodety-lightbox-close]');
    if (closer) {
      event.preventDefault();
      closer.closest('dialog')?.close?.();
      return;
    }
    document.querySelectorAll('[data-kodety-locale-selector][open]').forEach(selector => {
      if (!selector.contains(target)) selector.removeAttribute('open');
    });
    for (const root of [...openOverlays].reverse()) {
      if (root.contains(target) || overlayControls(root).some(control => control.contains(target))) return;
      const closeOutside = root.getAttribute('data-kodety-overlay-close-outside');
      if (closeOutside !== null && ['0', 'false', 'no', 'off'].includes(closeOutside.trim().toLowerCase())) return;
      closeOverlay(root, { restoreFocus: false });
      return;
    }
  });
  document.addEventListener('keydown', event => {
    const root = openOverlays[openOverlays.length - 1];
    if (!root) return;
    if (event.key === 'Escape' && root.getAttribute('data-kodety-overlay-close-escape') !== 'false') {
      event.preventDefault();
      closeOverlay(root);
      return;
    }
    if (event.key !== 'Tab' || !isModalOverlay(root)) return;
    const surface = root.querySelector('[data-kodety-overlay-surface]');
    if (!(surface instanceof HTMLElement)) return;
    const focusable = Array.from(surface.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(item => !item.hidden);
    if (!focusable.length) { event.preventDefault(); surface.focus(); return; }
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  let positionFrame = 0;
  const reposition = () => {
    cancelAnimationFrame(positionFrame);
    positionFrame = requestAnimationFrame(() => openOverlays.forEach(positionOverlay));
  };
  addEventListener('resize', reposition, { passive: true });
  addEventListener('scroll', reposition, { passive: true, capture: true });
  const installTooltipHandlers = (root, overlay) => {
    if (root.getAttribute('data-kodety-overlay') !== 'tooltip') return;
    let timerState = tooltipTimers.get(root);
    if (!timerState) {
      timerState = { value: 0 };
      tooltipTimers.set(root, timerState);
    }
    const show = event => {
      clearTooltipTimer(root);
      timerState.value = setTimeout(() => openOverlay(root, event.currentTarget), 80);
    };
    const hide = () => {
      clearTooltipTimer(root);
      timerState.value = setTimeout(() => closeOverlay(root, { restoreFocus: false }), 100);
    };
    overlay.triggers.forEach(trigger => {
      if (tooltipTriggers.has(trigger)) return;
      tooltipTriggers.add(trigger);
      trigger.addEventListener('pointerenter', show);
      trigger.addEventListener('pointerleave', hide);
      trigger.addEventListener('focus', show);
      trigger.addEventListener('blur', hide);
    });
    if (overlay.surface && !tooltipSurfaces.has(overlay.surface)) {
      tooltipSurfaces.add(overlay.surface);
      overlay.surface.addEventListener('pointerenter', () => clearTooltipTimer(root));
      overlay.surface.addEventListener('pointerleave', hide);
    }
  };
  function initializeOverlayRoot(root) {
    if (!(root instanceof HTMLElement)) return;
    const overlay = liveOverlayParts(root);
    const previousSurface = initializedSurfaces.get(root);
    const previousBackdrop = initializedBackdrops.get(root);
    if (!(overlay.surface instanceof HTMLElement)) {
      if (initializedOverlays.has(root) || openOverlays.includes(root)) closeOverlay(root, { restoreFocus: false, silent: true });
      forgetInitializedOverlayParts(root);
      return;
    }
    if (previousSurface && previousSurface !== overlay.surface) {
      if (cachedOverlayPartForRoot(root, previousSurface)) setOverlayPartClosed(previousSurface);
      if (dialogOwners.get(previousSurface) === root) dialogOwners.delete(previousSurface);
      if (previousSurface === root) {
        root.hidden = false;
        root.removeAttribute('inert');
        root.removeAttribute('aria-hidden');
      }
    }
    initializedSurfaces.set(root, overlay.surface);
    installOverlayDialogHandlers(root, overlay.surface);
    if (previousBackdrop && previousBackdrop !== overlay.backdrop && cachedOverlayPartForRoot(root, previousBackdrop)) {
      setOverlayPartClosed(previousBackdrop);
    }
    if (overlay.backdrop instanceof HTMLElement) initializedBackdrops.set(root, overlay.backdrop);
    else initializedBackdrops.delete(root);
    root.removeAttribute('data-kodety-overlay-default-open');
    root.removeAttribute('data-html-editor-overlay-forced-open');
    if (!initializedOverlays.has(root)) {
      initializedOverlays.add(root);
      closeOverlay(root, { restoreFocus: false, silent: true });
    } else if (openOverlays.includes(root)) {
      root.dataset.state = 'open';
      setOverlayPartsOpen(root, overlay);
      positionOverlay(root);
    } else {
      closeOverlay(root, { restoreFocus: false, silent: true });
    }
    root.setAttribute('data-kodety-overlay-ready', 'true');
    installTooltipHandlers(root, overlayParts(root));
  }
  const refreshOverlays = (scope = document) => {
    const candidates = [];
    if (scope instanceof Element) {
      const owner = scope.matches(OVERLAY_ROOT_SELECTOR) ? scope : nearestOverlayRoot(scope);
      if (owner) candidates.push(owner);
    }
    if (scope && typeof scope.querySelectorAll === 'function') {
      candidates.push(...scope.querySelectorAll(OVERLAY_ROOT_SELECTOR));
    }
    Array.from(new Set(candidates)).forEach(initializeOverlayRoot);
    document.documentElement.setAttribute('data-kodety-native-components-ready', 'true');
  };
  window.KodetyOverlays = {
    open: openOverlay,
    close: closeOverlay,
    toggle: toggleOverlay,
    position: positionOverlay,
    refresh: refreshOverlays,
  };
  refreshOverlays();
  if (typeof MutationObserver === 'function') {
    new MutationObserver(mutations => {
      let refreshNeeded = false;
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          if (mutation.attributeName === 'data-kodety-overlay'
            && target instanceof HTMLElement
            && initializedOverlays.has(target)
            && !target.matches(OVERLAY_ROOT_SELECTOR)) {
            closeOverlay(target, { restoreFocus: false, silent: true });
            forgetInitializedOverlayParts(target);
          }
          refreshNeeded = true;
          return;
        }
        mutation.removedNodes.forEach(node => {
          if (!(node instanceof Element)) return;
          refreshNeeded = true;
          const removedRoots = node.matches(OVERLAY_ROOT_SELECTOR)
            ? [node, ...node.querySelectorAll(OVERLAY_ROOT_SELECTOR)]
            : Array.from(node.querySelectorAll(OVERLAY_ROOT_SELECTOR));
          removedRoots.forEach(root => {
            closeOverlay(root, { restoreFocus: false, silent: true });
            forgetInitializedOverlayParts(root);
          });
        });
        if (Array.from(mutation.addedNodes).some(node => node instanceof Element)) refreshNeeded = true;
      });
      if (refreshNeeded) refreshOverlays();
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-kodety-overlay',
        'data-kodety-overlay-surface',
        'data-kodety-overlay-backdrop',
        'data-kodety-overlay-trigger',
        'data-kodety-overlay-open',
        'data-kodety-overlay-toggle',
        'data-kodety-overlay-target',
        'aria-controls',
      ],
    });
  }
})();
</script>
HTML;
    if (stripos($html, '</body>') !== false) {
        return (string) preg_replace('/<\/body>/i', $runtime . '</body>', $html, 1);
    }
    return $html . $runtime;
}
