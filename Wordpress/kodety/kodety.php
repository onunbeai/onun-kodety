<?php
/**
 * Plugin Name: Onun Kodety
 * Description: Importa sites HTML em ZIP, converte-os em temas WordPress e permite edição visual em /kodety.
 * Version: 1.1.40
 * Author: Onun contributors
 * License: GPL-3.0-only
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Requires at least: 6.4
 * Requires PHP: 8.0
 * Text Domain: kodety
 */

defined('ABSPATH') || exit;

define('KODETY_PRO_ACTIVE', true);
define('KODETY_EDITION', 'pro');
define('KODETY_VERSION', '1.1.40');
define('KODETY_FILE', __FILE__);
define('KODETY_DIR', plugin_dir_path(__FILE__));
define('KODETY_URL', plugin_dir_url(__FILE__));

// The editor's font picker uploads web fonts through the authenticated
// WordPress Media REST endpoint. Keep these formats available to editors while
// preserving WordPress' normal MIME allow-list for every other file type.
add_filter('upload_mimes', static function (array $mimes): array {
    if (current_user_can('kodety_edit')) {
        $mimes['woff'] = 'font/woff';
        $mimes['woff2'] = 'font/woff2';
        $mimes['ttf'] = 'font/ttf';
        $mimes['otf'] = 'font/otf';
    }
    return $mimes;
});

require_once KODETY_DIR . 'includes/class-kodety-edition.php';
require_once KODETY_DIR . 'includes/class-kodety-assets.php';
require_once KODETY_DIR . 'includes/class-kodety-admin-i18n.php';
require_once KODETY_DIR . 'includes/class-kodety-updates.php';
require_once KODETY_DIR . 'includes/class-kodety-license.php';
require_once KODETY_DIR . 'includes/class-kodety-extension-api.php';
require_once KODETY_DIR . 'includes/class-kodety-extensions.php';
require_once KODETY_DIR . 'includes/class-kodety-analytics.php';
require_once KODETY_DIR . 'includes/class-kodety-meta-capi.php';
require_once KODETY_DIR . 'includes/class-kodety-search-console.php';
require_once KODETY_DIR . 'includes/class-kodety-adobe-fonts.php';
require_once KODETY_DIR . 'includes/class-kodety-observability.php';
require_once KODETY_DIR . 'includes/class-kodety-plugin.php';
require_once KODETY_DIR . 'includes/class-kodety-template-library.php';
require_once KODETY_DIR . 'includes/class-kodety-sharing.php';
require_once KODETY_DIR . 'includes/class-kodety-help.php';
require_once KODETY_DIR . 'includes/class-kodety-builder-onboarding.php';
require_once KODETY_DIR . 'includes/class-kodety-security.php';
require_once KODETY_DIR . 'includes/class-kodety-ai.php';
require_once KODETY_DIR . 'includes/class-kodety-agents.php';
require_once KODETY_DIR . 'includes/class-kodety-native-operations.php';
require_once KODETY_DIR . 'includes/class-kodety-mcp.php';
require_once KODETY_DIR . 'includes/class-kodety-emails.php';
require_once KODETY_DIR . 'includes/class-kodety-media.php';
require_once KODETY_DIR . 'includes/class-kodety-social-images.php';

// Keep a single management experience: the native WP Admin item opens the
// same Builder workspace instead of maintaining a second, divergent screen.
add_filter(
    'kodety_members_admin_redirect_url',
    static fn(): string => home_url('/kodety/members/')
);

/**
 * Render one Elementor document with the plugin's own frontend API. This runs
 * during Onun Kodety activation, while Elementor is loaded but before it is
 * deactivated, and therefore does not depend on an HTTP request back to the
 * same WordPress process.
 */
function kodety_render_elementor_document_for_snapshot(int $post_id, string $source_url): string {
    if (
        $post_id <= 0
        || !class_exists('Elementor\\Plugin')
        || !function_exists('wp_scripts')
        || !function_exists('wp_styles')
    ) return '';

    $had_scripts = array_key_exists('wp_scripts', $GLOBALS);
    $had_styles = array_key_exists('wp_styles', $GLOBALS);
    $previous_scripts = $GLOBALS['wp_scripts'] ?? null;
    $previous_styles = $GLOBALS['wp_styles'] ?? null;
    $had_post = array_key_exists('post', $GLOBALS);
    $previous_post = $GLOBALS['post'] ?? null;
    $had_wp_query = array_key_exists('wp_query', $GLOBALS);
    $previous_wp_query = $GLOBALS['wp_query'] ?? null;
    $dependency_output_flags = [];
    foreach (['concatenate_scripts', 'compress_scripts', 'compress_css'] as $flag) {
        $dependency_output_flags[$flag] = [
            'exists' => array_key_exists($flag, $GLOBALS),
            'value' => $GLOBALS[$flag] ?? null,
        ];
    }
    $previous_user_id = function_exists('get_current_user_id') ? (int) get_current_user_id() : 0;
    $user_was_switched = false;
    $buffer_level = ob_get_level();

    try {
        $plugin = method_exists('Elementor\\Plugin', 'instance')
            ? \Elementor\Plugin::instance()
            : null;
        $frontend = is_object($plugin) && isset($plugin->frontend) ? $plugin->frontend : null;
        if (!is_object($frontend) || !method_exists($frontend, 'get_builder_content_for_display')) return '';

        // Do not mix wp-admin assets into the portable snapshot. WordPress'
        // dependency registries are restored byte-for-byte in the finally.
        unset($GLOBALS['wp_scripts'], $GLOBALS['wp_styles']);
        // wp-admin normally combines core files into load-scripts.php and
        // load-styles.php. Those dynamic endpoints cannot be copied as static
        // project files, so emit each real dependency URL instead.
        $GLOBALS['concatenate_scripts'] = false;
        $GLOBALS['compress_scripts'] = false;
        $GLOBALS['compress_css'] = false;
        $isolated_scripts = wp_scripts();
        $isolated_styles = wp_styles();
        // Add-ons often register widget dependencies during boot and only
        // enqueue those handles while rendering. Carry registrations into the
        // clean queues, cloning each dependency so inline data cannot mutate
        // the original wp-admin registries.
        foreach ([[$previous_scripts, $isolated_scripts], [$previous_styles, $isolated_styles]] as [$source_registry, $target_registry]) {
            if (!is_object($source_registry) || !is_object($target_registry)
                || !isset($source_registry->registered) || !is_array($source_registry->registered)
            ) continue;
            foreach ($source_registry->registered as $handle => $dependency) {
                if (is_object($dependency)) $target_registry->registered[$handle] = clone $dependency;
            }
        }

        // Elementor treats a matching global post ID as recursive template
        // embedding and returns an empty string. Activation normally has no
        // queried post, but clear that one collision defensively.
        if (function_exists('get_the_ID') && (int) get_the_ID() === $post_id && array_key_exists('post', $GLOBALS)) {
            unset($GLOBALS['post']);
        }
        // Generate the same public configuration a visitor receives. Keeping
        // the activating administrator here would archive their roles and
        // short-lived nonces inside the imported site's JavaScript.
        if (function_exists('wp_set_current_user')) {
            wp_set_current_user(0);
            $user_was_switched = true;
        }

        if (method_exists($frontend, 'register_scripts')) $frontend->register_scripts();
        if (method_exists($frontend, 'register_styles')) $frontend->register_styles();

        ob_start();
        $content = (string) $frontend->get_builder_content_for_display($post_id, true);
        $render_output = (string) ob_get_clean();
        if ($render_output !== '') $content = $render_output . $content;
        if ($content === '' || !preg_match('~(?:data-elementor-(?:type|id)|data-widget_type|\belementor-element\b)~i', $content)) {
            return '';
        }

        // Rendering is complete, so exposing the target as the current public
        // page can no longer trigger Elementor's recursion guard. It does make
        // elementorFrontendConfig.post accurate for share/widgets/runtime.
        $page = get_post($post_id);
        if (is_object($page)) {
            $GLOBALS['post'] = $page;
            $query = is_object($previous_wp_query)
                ? clone $previous_wp_query
                : (class_exists('WP_Query') ? new WP_Query() : null);
            if (is_object($query)) {
                $query->is_page = true;
                $query->is_singular = true;
                $query->is_single = false;
                $query->is_attachment = false;
                $query->is_home = false;
                $query->is_archive = false;
                $query->is_404 = false;
                $query->queried_object = $page;
                $query->queried_object_id = $post_id;
                $query->post = $page;
                $query->posts = [$page];
                $query->post_count = 1;
                $GLOBALS['wp_query'] = $query;
            }
        }

        if (method_exists($frontend, 'enqueue_styles')) $frontend->enqueue_styles();
        if (method_exists($frontend, 'enqueue_scripts')) $frontend->enqueue_scripts();
        // Keep the generated post stylesheet even though Elementor normally
        // also prints page CSS inline when $with_css is true. Some Elementor
        // versions/add-ons put responsive or widget rules only in this handle;
        // dropping it makes the snapshot look correct until Elementor is
        // deactivated and then loses the page-specific layout.
        if (function_exists('wp_enqueue_style') && function_exists('wp_style_is') && wp_style_is('elementor-post-' . $post_id, 'registered')) {
            wp_enqueue_style('elementor-post-' . $post_id);
        }
        // enqueue_styles() has an internal one-request guard. Activation can
        // snapshot several pages in the same request, so explicitly restore
        // the shared frontend handle in every isolated dependency registry.
        if (function_exists('wp_enqueue_style') && function_exists('wp_style_is') && wp_style_is('elementor-frontend', 'registered')) {
            wp_enqueue_style('elementor-frontend');
        }

        $theme_stylesheet = function_exists('get_stylesheet_uri') ? get_stylesheet_uri() : '';
        if (is_string($theme_stylesheet) && preg_match('~^https?://~i', $theme_stylesheet)) {
            wp_enqueue_style('kodety-elementor-theme', $theme_stylesheet, [], null);
        }

        ob_start();
        if (method_exists($frontend, 'print_fonts_links')) $frontend->print_fonts_links();
        wp_print_styles();
        wp_print_head_scripts();
        $head_assets = (string) ob_get_clean();

        ob_start();
        wp_print_footer_scripts();
        $footer_assets = (string) ob_get_clean();

        $title = function_exists('get_the_title') ? (string) get_the_title($post_id) : '';
        $language = function_exists('get_bloginfo') ? (string) get_bloginfo('language') : 'en-US';
        $kit_id = absint(get_option('elementor_active_kit', 0));
        $kit_css_assets = '';
        if ($kit_id > 0 && class_exists('Elementor\\Core\\Files\\CSS\\Post')) {
            try {
                $kit_css = \Elementor\Core\Files\CSS\Post::create($kit_id);
                if (is_object($kit_css) && method_exists($kit_css, 'print_css')) {
                    ob_start();
                    $kit_css->print_css();
                    $kit_css_assets = (string) ob_get_clean();
                }
            } catch (Throwable) {
                while (ob_get_level() > $buffer_level) ob_end_clean();
                $kit_css_assets = '';
            }
        }
        $body_classes = array_filter([
            'elementor-default',
            $kit_id > 0 ? 'elementor-kit-' . $kit_id : '',
            'elementor-page',
            'elementor-page-' . $post_id,
        ]);
        $canonical = preg_match('~^https?://~i', $source_url)
            ? '<link rel="canonical" href="' . esc_url($source_url) . '">' : '';
        $html = '<!doctype html><html lang="' . esc_attr($language) . '"><head>'
            . '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            . '<title>' . esc_html($title) . '</title>' . $canonical . $kit_css_assets . $head_assets
            . '</head><body class="' . esc_attr(implode(' ', $body_classes)) . '">'
            . $content . $footer_assets . '</body></html>';

        if (strlen($html) > 15 * MB_IN_BYTES) return '';
        return preg_match('~(?:data-elementor-(?:type|id)|data-widget_type|\belementor-element\b)~i', $html)
            ? $html
            : '';
    } catch (Throwable) {
        return '';
    } finally {
        while (ob_get_level() > $buffer_level) ob_end_clean();
        if ($had_scripts) $GLOBALS['wp_scripts'] = $previous_scripts;
        else unset($GLOBALS['wp_scripts']);
        if ($had_styles) $GLOBALS['wp_styles'] = $previous_styles;
        else unset($GLOBALS['wp_styles']);
        if ($had_post) $GLOBALS['post'] = $previous_post;
        else unset($GLOBALS['post']);
        if ($had_wp_query) $GLOBALS['wp_query'] = $previous_wp_query;
        else unset($GLOBALS['wp_query']);
        foreach ($dependency_output_flags as $flag => $state) {
            if ($state['exists']) $GLOBALS[$flag] = $state['value'];
            else unset($GLOBALS[$flag]);
        }
        if ($user_was_switched) wp_set_current_user($previous_user_id);
    }
}

/**
 * Save the published Elementor document while Elementor is still the only
 * active builder. The later onboarding conversion can then preserve widgets,
 * CSS and JavaScript even though Elementor is already inactive by that time.
 * Every detected page receives its own bounded snapshot. The onboarding can
 * therefore show the inventory and import the document explicitly selected by
 * the administrator instead of guessing the front page.
 */
function kodety_capture_elementor_rendered_snapshot_before_deactivation(): void {
    if (!function_exists('get_posts')) return;

    $candidate_ids = [];
    $front_page_id = absint(get_option('page_on_front', 0));
    if ($front_page_id > 0) $candidate_ids[] = $front_page_id;
    $matches = get_posts([
        'post_type' => 'page',
        'post_status' => ['publish', 'future', 'private', 'draft', 'pending'],
        // Hard bounded for activation safety. One extra row records whether
        // the inventory was truncated without ever starting an open crawler.
        'numberposts' => 101,
        'fields' => 'ids',
        'orderby' => 'ID',
        'order' => 'ASC',
        'suppress_filters' => true,
        'meta_key' => '_elementor_data',
        'meta_compare' => 'EXISTS',
    ]);
    foreach (is_array($matches) ? $matches : [] as $match) {
        $post_id = absint(is_object($match) && isset($match->ID) ? $match->ID : $match);
        if ($post_id > 0 && !in_array($post_id, $candidate_ids, true)) $candidate_ids[] = $post_id;
    }
    $truncated = count($candidate_ids) > 100;
    $candidate_ids = array_slice($candidate_ids, 0, 100);

    $registry = [
        'version' => 1,
        'capturedAt' => time(),
        'limit' => 100,
        'truncated' => $truncated,
        'pages' => [],
    ];
    $legacy_snapshot = null;
    $successful = 0;
    foreach ($candidate_ids as $post_id) {
        $raw = get_post_meta($post_id, '_elementor_data', true);
        if ((!is_string($raw) || trim($raw) === '') && !is_array($raw)) continue;
        $post = get_post($post_id);
        $url = get_permalink($post_id);
        if (!is_string($url) || $url === '') $url = add_query_arg('page_id', (string) $post_id, home_url('/'));
        $metadata = [
            'postId' => $post_id,
            'title' => is_object($post) ? (string) ($post->post_title ?? '') : '',
            'status' => is_object($post) ? (string) ($post->post_status ?? '') : '',
            'sourceUrl' => $url,
            'capturedAt' => time(),
            'available' => false,
            'captureMethod' => '',
            'sha256' => '',
            'error' => 'render-failed',
        ];
        $html = kodety_render_elementor_document_for_snapshot($post_id, $url);
        $capture_method = $html !== '' ? 'elementor-frontend-api' : '';

        // The direct Elementor render is the authoritative local handoff and
        // already contains its page CSS. Use one bounded loopback request only
        // when that render failed; never fetch every detected page over HTTP
        // during plugin activation.
        if ($html === '' && function_exists('wp_safe_remote_get') && function_exists('wp_http_validate_url') && wp_http_validate_url($url)) {
            $response = wp_safe_remote_get($url, [
                'timeout' => 5,
                'redirection' => 3,
                'reject_unsafe_urls' => true,
                'limit_response_size' => 15 * MB_IN_BYTES,
                'user-agent' => 'KodetyElementorSnapshot/1.0 (+WordPress)',
                'headers' => [
                    'Accept' => 'text/html,application/xhtml+xml',
                    'Cache-Control' => 'no-cache',
                ],
            ]);
            if (!is_wp_error($response)) {
                $status = (int) wp_remote_retrieve_response_code($response);
                $candidate_html = (string) wp_remote_retrieve_body($response);
                if ($status >= 200 && $status < 400 && $candidate_html !== '' && strlen($candidate_html) <= 15 * MB_IN_BYTES
                    && preg_match('~(?:data-elementor-(?:type|id)|data-widget_type|class=["\'][^"\']*\belementor(?:-element|-page)?\b|/plugins/elementor/)~i', $candidate_html)
                ) {
                    $html = $candidate_html;
                    $capture_method = 'published-http';
                }
            }
        }
        if ($html === '' || strlen($html) > 15 * MB_IN_BYTES
            || !preg_match('~(?:data-elementor-(?:type|id)|data-widget_type|class=["\'][^"\']*\belementor(?:-element|-page)?\b|/plugins/elementor/)~i', $html)
        ) {
            $registry['pages'][(string) $post_id] = $metadata;
            continue;
        }
        $snapshot = [
            'version' => 2,
            'postId' => $post_id,
            'title' => $metadata['title'],
            'status' => $metadata['status'],
            'sourceUrl' => $url,
            'capturedAt' => time(),
            'captureMethod' => $capture_method,
            'sha256' => hash('sha256', $html),
            'html' => $html,
        ];
        update_option('kodety_elementor_rendered_snapshot_' . $post_id, $snapshot, false);
        $stored = get_option('kodety_elementor_rendered_snapshot_' . $post_id, []);
        $stored_ok = is_array($stored)
            && (int) ($stored['postId'] ?? 0) === (int) $snapshot['postId']
            && is_string($stored['html'] ?? null)
            && hash_equals((string) $snapshot['sha256'], hash('sha256', (string) $stored['html']));
        if ($stored_ok) {
            $successful++;
            $metadata['available'] = true;
            $metadata['captureMethod'] = $capture_method;
            $metadata['sha256'] = $snapshot['sha256'];
            $metadata['error'] = '';
            if (!is_array($legacy_snapshot)) $legacy_snapshot = $snapshot;
        } else {
            $metadata['error'] = 'snapshot-store-failed';
        }
        $registry['pages'][(string) $post_id] = $metadata;
    }
    update_option('kodety_elementor_rendered_snapshots', $registry, false);
    if (is_array($legacy_snapshot)) {
        // Keep the historical single option so an in-place upgrade and older
        // code paths can still consume the first successful capture.
        update_option('kodety_elementor_rendered_snapshot', $legacy_snapshot, false);
    }
    if ($successful > 0) {
        delete_option('kodety_elementor_snapshot_error');
    } else {
        update_option('kodety_elementor_snapshot_error', [
            'code' => $candidate_ids === [] ? 'no-published-page' : 'render-failed',
            'pageCount' => count($candidate_ids),
            'at' => time(),
        ], false);
    }
}

/** Whether a plugin basename belongs to the incompatible Elementor Pro layer. */
function kodety_is_elementor_pro_layer(string $plugin, array $metadata = []): bool {
    $plugin = strtolower(trim($plugin));
    if (in_array($plugin, [
        'elementor-pro/elementor-pro.php',
        'pro-elements/pro-elements.php',
    ], true)) return true;

    // Keep the check deliberately narrow: the free Elementor plugin must stay
    // active because it renders the published HTML and generated page CSS used
    // by the converter. Metadata covers repackaged Pro Elements directories
    // without matching unrelated Elementor add-ons.
    $name = strtolower(trim((string) ($metadata['Name'] ?? '')));
    $domain = strtolower(trim((string) ($metadata['TextDomain'] ?? '')));
    return in_array($name, ['elementor pro', 'pro elements'], true)
        || in_array($domain, ['elementor-pro', 'pro-elements'], true);
}

/** @return list<string> */
function kodety_active_elementor_pro_layers(): array {
    if (!function_exists('deactivate_plugins') || !function_exists('is_plugin_active')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }
    $installed = function_exists('get_plugins') ? get_plugins() : [];
    $active = [];
    foreach ((array) get_option('active_plugins', []) as $plugin) {
        if (!is_string($plugin) || !kodety_is_elementor_pro_layer($plugin, (array) ($installed[$plugin] ?? []))) continue;
        if (is_plugin_active($plugin)) $active[] = $plugin;
    }
    foreach (['elementor-pro/elementor-pro.php', 'pro-elements/pro-elements.php'] as $known) {
        if (is_plugin_active($known) && !in_array($known, $active, true)) $active[] = $known;
    }
    return array_values(array_unique($active));
}

/**
 * Disable only Elementor Pro/Pro Elements before Onun Kodety starts. Elementor Free
 * intentionally remains active so conversion can read the real public widget
 * DOM, generated post CSS and frontend dependencies on demand.
 */
function kodety_deactivate_elementor_pro_before_activation(): void {
    if (!function_exists('deactivate_plugins') || !function_exists('is_plugin_active')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }

    $active = kodety_active_elementor_pro_layers();
    // Remove the legacy flag from 1.1.21: it described the free Elementor
    // plugin as disabled, which is no longer the compatibility model.
    delete_option('kodety_elementor_deactivated_on_activation');
    delete_option('kodety_elementor_pro_deactivated_on_activation');
    if ($active === []) return;

    deactivate_plugins($active, true, false);
    $remaining = array_values(array_filter(
        $active,
        static fn(string $plugin): bool => is_plugin_active($plugin)
    ));
    if ($remaining !== []) {
        wp_die(
            'O Onun Kodety não pôde desativar o Elementor Pro/Pro Elements com segurança. Desative somente a camada Pro e tente ativar o Onun Kodety novamente; mantenha o Elementor gratuito ativo.',
            'Onun Kodety — conflito com Elementor Pro',
            ['response' => 500, 'back_link' => true]
        );
    }

    update_option('kodety_elementor_pro_deactivated_on_activation', [
        'plugins' => $active,
        'elementorFreeKeptActive' => is_plugin_active('elementor/elementor.php'),
        'at' => time(),
    ], false);
}

/** Stop wp-admin from loading an incompatible Pro layer beside active Onun Kodety. */
function kodety_prevent_elementor_pro_activation_request(): void {
    if (!is_admin() || !current_user_can('activate_plugins')) return;
    $action = isset($_REQUEST['action']) && is_string($_REQUEST['action'])
        ? sanitize_key(wp_unslash($_REQUEST['action']))
        : '';
    if (!in_array($action, ['activate', 'activate-selected'], true)) return;

    $requested = [];
    if ($action === 'activate' && isset($_REQUEST['plugin']) && is_string($_REQUEST['plugin'])) {
        $requested[] = plugin_basename(wp_unslash($_REQUEST['plugin']));
    } elseif ($action === 'activate-selected' && isset($_REQUEST['checked']) && is_array($_REQUEST['checked'])) {
        foreach (wp_unslash($_REQUEST['checked']) as $plugin) {
            if (is_string($plugin)) $requested[] = plugin_basename($plugin);
        }
    }
    if ($requested === []) return;
    if (!function_exists('get_plugins')) require_once ABSPATH . 'wp-admin/includes/plugin.php';
    $installed = get_plugins();
    foreach ($requested as $plugin) {
        if (!kodety_is_elementor_pro_layer($plugin, (array) ($installed[$plugin] ?? []))) continue;
        wp_die(
            'Elementor Pro e Pro Elements não podem ser ativados enquanto o Onun Kodety estiver ativo, pois essa combinação pode derrubar o WordPress. O Elementor gratuito deve permanecer ativo para a conversão. Desative o Onun Kodety primeiro se realmente precisar reativar a camada Pro.',
            'Onun Kodety — ativação bloqueada com segurança',
            ['response' => 409, 'back_link' => true]
        );
    }
}
add_action('admin_init', 'kodety_prevent_elementor_pro_activation_request', -1000);

/** Fallback for CLI or integrations that bypass the normal plugins.php action. */
function kodety_deactivate_elementor_pro_after_external_activation(string $plugin): void {
    if (!kodety_is_elementor_pro_layer($plugin)) return;
    if (!function_exists('deactivate_plugins')) require_once ABSPATH . 'wp-admin/includes/plugin.php';
    deactivate_plugins([$plugin], true, false);
    update_option('kodety_elementor_pro_deactivated_on_activation', [
        'plugins' => [$plugin],
        'elementorFreeKeptActive' => is_plugin_active('elementor/elementor.php'),
        'at' => time(),
        'reason' => 'reactivation-blocked',
    ], false);
}
add_action('activated_plugin', 'kodety_deactivate_elementor_pro_after_external_activation', 0, 1);

register_activation_hook(__FILE__, 'kodety_deactivate_elementor_pro_before_activation');
register_activation_hook(__FILE__, ['Kodety_Plugin', 'activate']);
register_activation_hook(__FILE__, ['Kodety_Sharing', 'activate']);
register_activation_hook(__FILE__, ['Kodety_Extensions', 'activate']);
register_activation_hook(__FILE__, ['Kodety_Security', 'activate']);
register_activation_hook(__FILE__, ['Kodety_Emails', 'activate']);
register_activation_hook(__FILE__, ['Kodety_Analytics', 'activate']);
register_activation_hook(__FILE__, ['Kodety_Meta_CAPI', 'activate']);
register_activation_hook(__FILE__, ['Kodety_Search_Console', 'activate']);
register_activation_hook(__FILE__, ['Kodety_License', 'activate_plugin']);
register_activation_hook(__FILE__, ['Kodety_Agents', 'activate']);
register_deactivation_hook(__FILE__, ['Kodety_Plugin', 'deactivate']);
register_deactivation_hook(__FILE__, ['Kodety_Agents', 'deactivate']);
register_deactivation_hook(__FILE__, ['Kodety_Emails', 'deactivate']);
register_deactivation_hook(__FILE__, ['Kodety_Analytics', 'deactivate']);
register_deactivation_hook(__FILE__, ['Kodety_Meta_CAPI', 'deactivate']);
register_deactivation_hook(__FILE__, ['Kodety_Search_Console', 'deactivate']);
register_deactivation_hook(__FILE__, ['Kodety_Social_Images', 'deactivate']);
register_deactivation_hook(__FILE__, ['Kodety_License', 'deactivate_plugin']);

// Active plugins are included sequentially. Initializing Onun Kodety while another
// page builder is still loading makes the result depend on the activation
// order and can leave both plugins unavailable. Wait until every active plugin
// file (including Elementor) has finished loading, then attach Onun Kodety's hooks.
// The negative priority still lets Onun Kodety subsystems register their own normal
// plugins_loaded callbacks for the same dispatch.
$kodety_bootstrap = static function (): void {
    static $booted = false;
    if ($booted) return;
    $booted = true;

    Kodety_Extension_API::instance();
    Kodety_Extensions::instance();
    Kodety_Admin_I18n::instance();
    Kodety_Observability::register();

    Kodety_Plugin::instance();
    Kodety_Updates::instance();
    Kodety_License::instance();
    Kodety_Template_Library::instance();
    Kodety_Sharing::instance();
    Kodety_Help::instance();
    Kodety_Builder_Onboarding::instance();
    Kodety_Security::instance();
    Kodety_AI::instance();
    Kodety_Agents::instance();
    Kodety_Native_Operations::instance();
    Kodety_MCP::instance();
    Kodety_Media::instance();
    Kodety_Social_Images::instance();
    Kodety_Emails::instance();
    Kodety_Analytics::instance();
    Kodety_Meta_CAPI::instance();
    Kodety_Search_Console::instance();
    Kodety_Adobe_Fonts::instance();
};

if (
    did_action('plugins_loaded')
    && in_array(plugin_basename(KODETY_FILE), (array) get_option('active_plugins', []), true)
) {
    // A late include of an already active plugin still needs its normal boot.
    // During first activation the plugin is not active yet, so the activation
    // hook above can remove incompatible Pro layers before Onun Kodety initializes
    // next request. Elementor Free remains active and finishes loading first.
    $kodety_bootstrap();
} elseif (!did_action('plugins_loaded')) {
    add_action('plugins_loaded', $kodety_bootstrap, -100);
}
