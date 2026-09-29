<?php
defined('ABSPATH') || exit;
$runtime_context = kodety_runtime_context();
$runtime_directory = kodety_runtime_directory();
$runtime_directory_uri = kodety_runtime_directory_uri();
$manifest_path = $runtime_directory . '/manifest.json';
$manifest = is_file($manifest_path) ? json_decode((string) file_get_contents($manifest_path), true) : [];
$request_path = isset($runtime_context['route'])
    ? trim((string) $runtime_context['route'], '/')
    : trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
$normalized_request_path = kodety_normalize_public_route_path($request_path);
$request_path = $normalized_request_path ?? $request_path;
$home_path = kodety_normalize_public_route_path(
    trim((string) parse_url(home_url('/'), PHP_URL_PATH), '/')
) ?? '';
if (!isset($runtime_context['route']) && $home_path !== '' && ($request_path === $home_path || str_starts_with($request_path, $home_path . '/'))) {
    $request_path = trim(substr($request_path, strlen($home_path)), '/');
}
$localization = kodety_localization_settings();
$locale_request = kodety_localization_request(
    $request_path,
    $localization,
    is_array($manifest) ? $manifest : []
);
$request_path = (string) $locale_request['base_route'];
$page_relative = is_singular('page') ? (string) get_post_meta(get_queried_object_id(), '_kodety_html_path', true) : '';
$cms_templates = kodety_project_cms_option('kodety_cms_templates', []);
$queried_post_type = is_singular() ? (string) get_post_type(get_queried_object_id()) : '';
$cms_relative = $queried_post_type !== '' && is_array($cms_templates) ? (string) ($cms_templates[$queried_post_type] ?? '') : '';
$relative = kodety_resolve_page_relative(is_array($manifest) ? $manifest : [], $request_path, $page_relative, $cms_relative);
$resolved_manifest_route = is_array($manifest) && kodety_manifest_relative_for_request($manifest, $request_path) !== '';
$is_authored_404_fallback = is_array($manifest)
    && !$resolved_manifest_route
    && $page_relative === ''
    && $cms_relative === ''
    && $relative === kodety_404_page_relative($manifest);
if ($is_authored_404_fallback) status_header(404);
$candidate = realpath($runtime_directory . '/site/' . $relative);
$site_root = realpath($runtime_directory . '/site');
if (!$candidate || !$site_root || !str_starts_with($candidate, trailingslashit($site_root)) || !is_file($candidate)) {
    status_header(404);
    $candidate = is_file($runtime_directory . '/site/404.html') ? $runtime_directory . '/site/404.html' : null;
}
if (!$candidate) {
    echo kodety_default_404_html(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- generated static fallback.
    exit;
}
// Locale-prefixed pages are virtual WordPress routes. Once the manifest has
// resolved a real HTML file they must be served as successful responses, even
// if the native query initially classified `/pt/...` as a 404.
if ($locale_request['prefixed'] || $resolved_manifest_route) {
    global $wp_query;
    if ($wp_query instanceof WP_Query) $wp_query->is_404 = false;
    status_header(200);
}
[$html, $custom_code_blocks] = kodety_protect_runtime_custom_code_blocks((string) file_get_contents($candidate));
$authored_relative = kodety_authored_relative_for_runtime($relative);
$html = function_exists('kodety_render_membership_html')
    ? kodety_render_membership_html($html, $relative)
    : $html;
$html = kodety_render_cms_html($html);
$html = kodety_render_localized_html(
    $html,
    $authored_relative,
    (string) $locale_request['locale_code'],
    $localization,
    is_array($manifest) ? $manifest : []
);
$html = kodety_rewrite_public_page_links($html, $authored_relative, is_array($manifest) ? $manifest : [], $locale_request, $localization);
// Multi-step navigation and CMS filtering are page behavior, not Inbox
// features. inject_runtime() decides independently whether submission capture
// is enabled, so the lightweight form runtime must remain available even when
// the Emails extension itself is turned off.
if (class_exists('Kodety_Emails')) {
    $html = Kodety_Emails::inject_runtime($html);
}
$html = function_exists('kodety_inject_membership_runtime')
    ? kodety_inject_membership_runtime($html)
    : $html;
$html = kodety_inject_native_components_runtime($html);
$relative_dir = str_replace('\\', '/', dirname($relative));
$relative_dir = $relative_dir === '.' ? '' : trim($relative_dir, '/');
$base = trailingslashit($runtime_directory_uri . '/site' . ($relative_dir ? '/' . $relative_dir : ''));
$base_tag = '<base href="' . esc_url($base) . '">';
$html = preg_replace('/<head(\s[^>]*)?>/i', '$0' . $base_tag, $html, 1, $count);
if (!$count) $html = $base_tag . $html;
// Root-relative authored URLs address the project root, which is the folder
// the main page was published from — not the directory of the current page.
$web_root = kodety_project_web_root(is_array($manifest) ? $manifest : []);
$web_root_suffix = $web_root === '' ? '' : '/' . $web_root;
$site_uri = trailingslashit($runtime_directory_uri . '/site' . $web_root_suffix);
if (preg_match('~^(\.kodety-experiments/[^/]+/[^/]+)(?:/|$)~', ltrim(str_replace('\\', '/', $relative), '/'), $variant_match)) {
    // Variant clones carry their complete dependency tree, including the
    // project's web root folder. Resolving to the clone's own root would drop
    // that folder and 404 every root-relative script the page depends on.
    $site_uri = trailingslashit($runtime_directory_uri . '/site/' . $variant_match[1] . $web_root_suffix);
}
$html = kodety_version_runtime_local_asset_urls($html);
[$html, $runtime_raw_text_payloads] = kodety_protect_runtime_raw_text_payloads($html);
$html = preg_replace_callback(
    '/\b(src|href|poster|action)=([' . "'\"" . '])\/(?!\/)([^' . "'\"" . ']*)\2/i',
    static fn(array $match): string => $match[1] . '=' . $match[2] . esc_url($site_uri . ltrim($match[3], '/')) . $match[2],
    $html
);
$html = preg_replace_callback(
    '/(?<![\w:-])(srcset|imagesrcset|data-srcset|data-lazy-srcset)(\s*=\s*)([\'\"])(.*?)\3/is',
    static function (array $match) use ($site_uri): string {
        $value = kodety_runtime_map_srcset($match[4], static fn(string $url): string =>
            str_starts_with($url, '/') && !str_starts_with($url, '//')
                ? esc_url($site_uri . ltrim($url, '/'))
                : $url
        );
        return $match[1] . $match[2] . $match[3] . $value . $match[3];
    },
    $html
);
$html = kodety_restore_runtime_raw_text_payloads($html, $runtime_raw_text_payloads);
$html = kodety_inject_public_routes_runtime(
    $html,
    $authored_relative,
    is_array($manifest) ? $manifest : [],
    $locale_request,
    $localization,
    $site_uri
);
$html = kodety_cleanup_runtime_html($html);

// Preserve the authored document while exposing the standard WordPress hook
// surface required by SEO, consent, analytics, accessibility and the admin bar.
$restore_core_title = preg_match('/<title\b/i', $html) === 1
    && has_action('wp_head', '_wp_render_title_tag') !== false;
if ($restore_core_title) remove_action('wp_head', '_wp_render_title_tag', 1);
$wordpress_head = kodety_capture_wordpress_head_for_document($html);
if ($restore_core_title) add_action('wp_head', '_wp_render_title_tag', 1);
if ($wordpress_head !== '') {
    [$hook_html, $hook_raw_text] = kodety_protect_runtime_raw_text_payloads($html);
    $hook_html = preg_replace('/<\/head\s*>/i', $wordpress_head . '</head>', $hook_html, 1, $head_hook_count);
    if (!$head_hook_count) $hook_html = $wordpress_head . $hook_html;
    $html = kodety_restore_runtime_raw_text_payloads((string) $hook_html, $hook_raw_text);
}
ob_start();
wp_body_open();
$wordpress_body_open = (string) ob_get_clean();
if ($wordpress_body_open !== '') {
    [$hook_html, $hook_raw_text] = kodety_protect_runtime_raw_text_payloads($html);
    $hook_html = preg_replace('/<body(\s[^>]*)?>/i', '$0' . $wordpress_body_open, $hook_html, 1, $body_hook_count);
    if (!$body_hook_count) $hook_html = $wordpress_body_open . $hook_html;
    $html = kodety_restore_runtime_raw_text_payloads((string) $hook_html, $hook_raw_text);
}
ob_start();
wp_footer();
$wordpress_footer = (string) ob_get_clean();
if ($wordpress_footer !== '') {
    [$hook_html, $hook_raw_text] = kodety_protect_runtime_raw_text_payloads($html);
    $hook_html = preg_replace('/<\/body\s*>/i', $wordpress_footer . '</body>', $hook_html, 1, $footer_hook_count);
    if (!$footer_hook_count) $hook_html .= $wordpress_footer;
    $html = kodety_restore_runtime_raw_text_payloads((string) $hook_html, $hook_raw_text);
}
$html = kodety_restore_runtime_custom_code_blocks($html, $custom_code_blocks);
$html = (string) apply_filters('kodety_runtime_html', $html, $runtime_context);
// The generated attachment belongs to the current content item, so apply it
// after authored markup and wp_head integrations have been assembled. This
// replaces duplicate SEO-plugin declarations as well as Onun Kodety's own fallback
// without exposing the private visual template in the public HTML.
if (is_singular()
    && class_exists('Kodety_Social_Images')
    && (!class_exists('Kodety_Edition') || Kodety_Edition::has('socialImageBuilder'))
) {
    $social_images = Kodety_Social_Images::instance();
    if (method_exists($social_images, 'apply_to_html')) {
        $html = $social_images->apply_to_html($html, (int) get_queried_object_id());
    }
}
$performance_helper = __DIR__ . '/performance.php';
if (!function_exists('kodety_output_compressed_html') && is_file($performance_helper)) require_once $performance_helper;
if (function_exists('kodety_output_compressed_html') && kodety_output_compressed_html($html, $runtime_directory)) return;
echo $html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted project output published by authorized users.
