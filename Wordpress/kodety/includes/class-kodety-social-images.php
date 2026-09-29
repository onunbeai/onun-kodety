<?php

defined('ABSPATH') || exit;

if (!class_exists('Kodety_Edition')) require_once __DIR__ . '/class-kodety-edition.php';

/**
 * Server-side Social Image runtime.
 *
 * The editable source remains in `.incode/project.json`. During publication
 * Kodety_Plugin calls project_contract_from_directory() and writes the returned
 * public, normalized contract to `social-images.json` in the generated theme.
 * This service never reads arbitrary remote URLs and never executes authored
 * HTML/CSS/JavaScript while rendering.
 */
final class Kodety_Social_Images {
    private const CONTRACT_FILE = 'social-images.json';
    private const CONTRACT_VERSION = 2;
    private const CRON_HOOK = 'kodety_social_images_generate';
    private const SCAN_CRON_HOOK = 'kodety_social_images_scan';
    private const GENERATION_BATCH_SIZE = 20;
    private const SCAN_BATCH_SIZE = 200;
    private const MAX_GENERATION_RETRIES = 3;
    private const RETRY_BASE_DELAY = 60;
    private const MAX_CONTRACT_BYTES = 16_000_000;
    private const MAX_PROJECT_METADATA_BYTES = 64_000_000;
    private const MAX_TEMPLATE_BYTES = 750_000;
    private const MAX_LIBRARY_TEMPLATES = 200;
    private const MAX_LIBRARY_CANDIDATES = 2000;
    private const MAX_LAYERS = 100;
    private const MAX_LAYER_DEPTH = 5;
    private const MAX_LAYER_PIXELS = 6_000_000;
    private const MAX_TOTAL_LAYER_PIXELS = 24_000_000;
    private const MAX_TEXT_BYTES = 20_000;
    private const MAX_ASSET_BYTES = 32_000_000;
    private const MAX_FONT_BYTES = 20_000_000;
    private const MAX_REMOTE_AVATAR_BYTES = 5_000_000;
    private const MAX_SOURCE_PIXELS = 16_000_000;
    private const MAX_CANVAS_PIXELS = 6_000_000;
    private const MIN_CANVAS_SIDE = 64;
    private const MAX_CANVAS_SIDE = 2400;
    /** GD/FreeType accepts points, while the editor contract stores CSS pixels. */
    private const CSS_PIXEL_TO_POINT = 0.75;
    private const GENERATION_LOCK_TTL = 10 * MINUTE_IN_SECONDS;

    private const META_ATTACHMENT = '_kodety_social_image_attachment_id';
    private const META_HASH = '_kodety_social_image_hash';
    private const META_TEMPLATE = '_kodety_social_image_template_id';
    private const META_ERROR = '_kodety_social_image_error';
    private const META_GENERATED = '_kodety_social_generated';
    private const META_SOURCE_POST = '_kodety_social_source_post';

    private static ?self $instance = null;

    /** @var array<int,true> */
    private array $queued_posts = [];

    /** @var array<int,true> */
    private array $generating_posts = [];

    private ?array $contract_cache = null;
    private string $contract_cache_path = '';
    private int $contract_cache_mtime = -1;
    private string $contract_revision_cache = '';
    private bool $contract_valid = false;
    private bool $cron_dispatch_pending = false;
    private bool $cron_dispatched = false;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    /**
     * Remove every asynchronous job owned by this runtime.
     *
     * Both hooks carry payload arguments, so wp_clear_scheduled_hook() with an
     * empty argument list would leave the real jobs behind. WordPress 6.4+
     * always provides wp_unschedule_hook(), but the fallback keeps this method
     * harmless in isolated tests and older bootstrap environments.
     */
    public static function deactivate(): void {
        foreach ([self::CRON_HOOK, self::SCAN_CRON_HOOK] as $hook) {
            if (function_exists('wp_unschedule_hook')) {
                wp_unschedule_hook($hook);
            } elseif (function_exists('wp_clear_scheduled_hook')) {
                wp_clear_scheduled_hook($hook);
            }
        }
    }

    private function __construct() {
        add_action('wp_after_insert_post', [$this, 'post_saved'], 100, 4);
        add_action('transition_post_status', [$this, 'post_status_changed'], 100, 3);
        add_action('added_post_meta', [$this, 'post_meta_changed'], 100, 4);
        add_action('updated_post_meta', [$this, 'post_meta_changed'], 100, 4);
        add_action('deleted_post_meta', [$this, 'post_meta_changed'], 100, 4);
        add_action('set_object_terms', [$this, 'post_terms_changed'], 100, 6);
        add_action('profile_update', [$this, 'author_updated'], 100, 1);
        add_action('updated_option', [$this, 'site_option_updated'], 100, 3);
        add_action('before_delete_post', [$this, 'before_delete_post'], 10, 2);
        add_action('shutdown', [$this, 'flush_queue'], 999);
        add_action('shutdown', [$this, 'dispatch_scheduled_cron'], 1000);
        add_action(self::CRON_HOOK, [$this, 'generate_queued'], 10, 1);
        add_action(self::SCAN_CRON_HOOK, [$this, 'scan_queued_posts'], 10, 1);
        add_action('kodety_published', [$this, 'regenerate_all'], 20, 1);
    }

    /**
     * Extract the Social Image portion of `.incode/project.json`.
     *
     * Supported authoring locations intentionally include a few forward- and
     * backwards-compatible aliases. The canonical UI fields are:
     * - siteSettings.socialImageTemplates
     * - siteSettings.socialImageTemplateId
     * - pageSettings[path].socialImageTemplateId
     *
     * Legacy embedded `socialImageTemplate` values remain readable. The public
     * contract stores each normalized template once and uses compact IDs for
     * site, page/CMS and post-type assignments.
     *
     * @return array{
     *   version:int,
     *   templates:array<string,array>,
     *   siteTemplate:?string,
     *   pageTemplates:array<string,string>,
     *   postTypeTemplates:array<string,string>,
     *   siteVariables:array<string,string>,
     *   pageVariables:array<string,array<string,string>>
     * }
     */
    public static function project_contract_from_directory(string $project_root): array {
        $empty = self::empty_contract();
        if (!Kodety_Edition::has('socialImageBuilder')) return $empty;
        $root = realpath($project_root);
        if (!is_string($root) || !is_dir($root)) return $empty;

        $metadata_path = $root . DIRECTORY_SEPARATOR . '.incode' . DIRECTORY_SEPARATOR . 'project.json';
        if (!is_file($metadata_path)) {
            $items = array_values(array_filter(
                scandir($root) ?: [],
                static fn(string $item): bool => !in_array($item, ['.', '..', '__MACOSX', '.DS_Store'], true)
            ));
            if (count($items) === 1 && is_dir($root . DIRECTORY_SEPARATOR . $items[0])) {
                $candidate_root = realpath($root . DIRECTORY_SEPARATOR . $items[0]);
                $candidate = is_string($candidate_root)
                    ? $candidate_root . DIRECTORY_SEPARATOR . '.incode' . DIRECTORY_SEPARATOR . 'project.json'
                    : '';
                if ($candidate !== '' && is_file($candidate)) $metadata_path = $candidate;
            }
        }
        if (!is_file($metadata_path) || is_link($metadata_path)) return $empty;
        $size = filesize($metadata_path);
        if (!is_int($size) || $size < 2 || $size > self::MAX_PROJECT_METADATA_BYTES) return $empty;
        $decoded = json_decode((string) file_get_contents($metadata_path), true);
        if (!is_array($decoded)) return $empty;

        return self::contract_from_metadata($decoded);
    }

    /** Read and revalidate the public projection generated at publish time. */
    public function published_contract(): array {
        if (!function_exists('get_template_directory')) return self::empty_contract();
        $path = rtrim((string) get_template_directory(), '/\\') . '/' . self::CONTRACT_FILE;
        $mtime = is_file($path) ? (int) filemtime($path) : -1;
        if ($this->contract_cache !== null
            && $path === $this->contract_cache_path
            && $mtime === $this->contract_cache_mtime) {
            return $this->contract_cache;
        }

        $contract = self::empty_contract();
        $this->contract_valid = false;
        if (is_file($path) && !is_link($path)) {
            $size = filesize($path);
            if (is_int($size) && $size >= 2 && $size <= self::MAX_CONTRACT_BYTES) {
                $decoded = json_decode((string) file_get_contents($path), true);
                if (is_array($decoded) && self::is_recognized_contract_shape($decoded)) {
                    $contract = self::sanitize_public_contract($decoded);
                    $this->contract_valid = true;
                }
            }
        }
        $this->contract_cache = $contract;
        $this->contract_cache_path = $path;
        $this->contract_cache_mtime = $mtime;
        $this->contract_revision_cache = self::hash_contract($contract);
        return $contract;
    }

    /**
     * A syntactically valid JSON object is not automatically a valid contract.
     * This distinction prevents a truncated `{}` deployment from being treated
     * as an intentional removal of every assignment during stale cleanup.
     */
    private static function is_recognized_contract_shape(array $raw): bool {
        $has_assignments = array_key_exists('siteTemplate', $raw)
            && is_array($raw['pageTemplates'] ?? null)
            && is_array($raw['postTypeTemplates'] ?? null);
        if ($has_assignments) {
            if (array_key_exists('templates', $raw)) {
                if (!is_array($raw['templates']) || (int) ($raw['version'] ?? 0) < 2) {
                    return false;
                }
                $library = self::template_library($raw['templates']);
                if (!self::compact_assignment_is_valid($raw['siteTemplate'], $library, true)) {
                    return false;
                }
                foreach ($raw['pageTemplates'] as $path => $assignment) {
                    if (self::path((string) $path) === ''
                        || !self::compact_assignment_is_valid($assignment, $library)) return false;
                }
                foreach ($raw['postTypeTemplates'] as $post_type => $assignment) {
                    if (self::key((string) $post_type) === ''
                        || !self::compact_assignment_is_valid($assignment, $library)) return false;
                }
                return true;
            }
            // Version 1 embedded complete templates in assignment values.
            if (isset($raw['version']) && (int) $raw['version'] !== 1) return false;
            if ($raw['siteTemplate'] !== null
                && !self::embedded_assignment_is_valid($raw['siteTemplate'])) return false;
            foreach ($raw['pageTemplates'] as $path => $assignment) {
                if (self::path((string) $path) === ''
                    || !self::embedded_assignment_is_valid($assignment)) return false;
            }
            foreach ($raw['postTypeTemplates'] as $post_type => $assignment) {
                if (self::key((string) $post_type) === ''
                    || !self::embedded_assignment_is_valid($assignment)) return false;
            }
            return true;
        }
        foreach (['siteSettings', 'pageSettings', 'socialImages', 'socialImageTemplates'] as $key) {
            if (array_key_exists($key, $raw) && is_array($raw[$key])) return true;
        }
        return false;
    }

    private static function compact_assignment_is_valid(
        mixed $assignment,
        array $library,
        bool $allow_null = false
    ): bool {
        if ($assignment === null) return $allow_null;
        if (!is_string($assignment)) return false;
        $id = self::template_id($assignment);
        return $id !== '' && isset($library[$id]);
    }

    private static function embedded_assignment_is_valid(mixed $assignment): bool {
        if (is_array($assignment)
            && isset($assignment['template'])
            && !isset($assignment['layers'])
            && !isset($assignment['elements'])) {
            $assignment = $assignment['template'];
        }
        return is_array($assignment)
            && (is_array($assignment['layers'] ?? null)
                || is_array($assignment['elements'] ?? null))
            && self::sanitize_template($assignment) !== null;
    }

    /**
     * Replace authored Open Graph/Twitter image declarations with the generated
     * attachment. Regex is deliberately restricted to complete <meta> tags so
     * raw script/style payloads are never inspected or serialized by DOMDocument.
     */
    public function apply_to_html(string $html, int $post_id): string {
        if (!Kodety_Edition::has('socialImageBuilder') || $html === '' || $post_id <= 0) return $html;
        $post = get_post($post_id);
        if (!$post instanceof WP_Post) return $html;
        $template = $this->template_for_post($post);
        $stored_template = (string) get_post_meta($post_id, self::META_TEMPLATE, true);
        if (!$template || $stored_template === '' || !hash_equals((string) $template['id'], $stored_template)) return $html;
        $attachment_id = absint(get_post_meta($post_id, self::META_ATTACHMENT, true));
        if (!$this->generated_attachment_is_valid($attachment_id, $post_id)) return $html;
        $url = (string) (wp_get_attachment_image_url($attachment_id, 'full') ?: '');
        if ($url === '') return $html;

        $metadata = wp_get_attachment_metadata($attachment_id);
        $width = is_array($metadata) ? absint($metadata['width'] ?? 0) : 0;
        $height = is_array($metadata) ? absint($metadata['height'] ?? 0) : 0;
        $mime = sanitize_text_field((string) (get_post_mime_type($attachment_id) ?: 'image/png'));
        $alt = get_the_title($post);

        [$protected_html, $raw_text] = $this->protect_raw_text($html);
        $protected_html = (string) preg_replace(
            '~\s*<meta\b(?=[^>]*\b(?:property|name)\s*=\s*(["\'])(?:og:image(?::(?:url|secure_url|width|height|type|alt))?|twitter:(?:image(?::src)?|card))\1)[^>]*>~i',
            '',
            $protected_html
        );
        $attribute = static fn(string $value): string => function_exists('esc_attr')
            ? esc_attr($value)
            : htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safe_url = function_exists('esc_url') ? esc_url($url) : $url;
        $tags = [
            '<meta property="og:image" content="' . $attribute($safe_url) . '">',
            '<meta property="og:image:url" content="' . $attribute($safe_url) . '">',
            '<meta property="og:image:type" content="' . $attribute($mime) . '">',
        ];
        if ($width > 0) $tags[] = '<meta property="og:image:width" content="' . $width . '">';
        if ($height > 0) $tags[] = '<meta property="og:image:height" content="' . $height . '">';
        if ($alt !== '') $tags[] = '<meta property="og:image:alt" content="' . $attribute($alt) . '">';
        $tags[] = '<meta name="twitter:card" content="summary_large_image">';
        $tags[] = '<meta name="twitter:image" content="' . $attribute($safe_url) . '">';
        $markup = implode("\n", $tags) . "\n";

        $updated = preg_replace('/<\/head\s*>/i', $markup . '</head>', $protected_html, 1, $count);
        if (!is_string($updated) || $count < 1) $updated = $markup . $protected_html;
        return $raw_text ? strtr($updated, $raw_text) : $updated;
    }

    /** @return array{0:string,1:array<string,string>} */
    private function protect_raw_text(string $html): array {
        if (!preg_match('~<(?:script|style)\b~i', $html)) return [$html, []];
        try {
            $nonce = bin2hex(random_bytes(12));
        } catch (Throwable) {
            $nonce = hash('sha256', uniqid('kodety-social-raw-', true));
        }
        $source = $html;
        $payloads = [];
        $protected = preg_replace_callback(
            '~(<(script|style)\b[^>]*>)([\s\S]*?)(</\2\s*>)~i',
            static function (array $match) use (&$payloads, $nonce, $source): string {
                $token = '__KODETY_SOCIAL_RAW_' . $nonce . '_' . count($payloads) . '__';
                while (str_contains($source, $token) || isset($payloads[$token])) $token .= '_';
                $payloads[$token] = $match[3];
                return $match[1] . $token . $match[4];
            },
            $html
        );
        return [is_string($protected) ? $protected : $html, $payloads];
    }

    /** Resolve one public template variable against the final WordPress state. */
    public function resolve_variable_for_post(string $token, mixed $post): mixed {
        $post = $post instanceof WP_Post ? $post : get_post(absint($post));
        if (!$post instanceof WP_Post) return '';
        $token = trim($token);
        if ($token === '' || strlen($token) > 128 || !preg_match('/^[A-Za-z0-9_.:-]+$/D', $token)) return '';

        $aliases = [
            'title' => 'page.title',
            'excerpt' => 'page.excerpt',
            'content' => 'page.content',
            'featured_image' => 'page.featured_image',
            'featured_image_alt' => 'page.featured_image_alt',
            'permalink' => 'page.permalink',
            'date' => 'page.date',
            'author' => 'author.name',
            'slug' => 'page.slug',
        ];
        $token = $aliases[$token] ?? $token;

        if (str_starts_with($token, 'field:') || str_starts_with($token, 'field.')) {
            $key = self::key(substr($token, 6));
            if ($key === '' || str_starts_with($key, '_')) return '';
            return function_exists('get_field')
                ? get_field($key, $post->ID)
                : get_post_meta($post->ID, $key, true);
        }

        if (str_starts_with($token, 'page.')) {
            $thumbnail_id = get_post_thumbnail_id($post);
            $project_page = $this->project_page_variables($post);
            $native_title = get_the_title($post);
            $native_excerpt = get_the_excerpt($post);
            $configured_title = $this->resolve_project_variable(
                (string) ($project_page['title'] ?? ''),
                $post,
                $native_title
            );
            $configured_excerpt = $this->resolve_project_variable(
                (string) ($project_page['excerpt'] ?? ''),
                $post,
                $native_excerpt
            );
            $configured_url = $this->resolve_project_variable(
                (string) ($project_page['url'] ?? ''),
                $post,
                (string) get_permalink($post)
            );
            return match ($token) {
                'page.title' => $configured_title,
                'page.excerpt' => $configured_excerpt,
                'page.content' => wp_strip_all_tags(
                    function_exists('apply_filters')
                        ? (string) apply_filters('the_content', $post->post_content)
                        : (string) $post->post_content
                ),
                'page.featured_image' => $thumbnail_id
                    ? (string) (wp_get_attachment_image_url($thumbnail_id, 'full') ?: '')
                    : '',
                'page.featured_image_alt' => $thumbnail_id
                    ? (string) get_post_meta($thumbnail_id, '_wp_attachment_image_alt', true)
                    : '',
                'page.permalink' => function_exists('kodety_cms_item_permalink')
                    ? kodety_cms_item_permalink($post)
                    : $configured_url,
                'page.url' => $configured_url,
                'page.date' => get_the_date('', $post),
                'page.slug' => $post->post_name,
                'page.id' => $post->ID,
                default => '',
            };
        }

        if (str_starts_with($token, 'author.')) {
            return match ($token) {
                'author.name' => get_the_author_meta('display_name', (int) $post->post_author),
                'author.first_name' => get_the_author_meta('first_name', (int) $post->post_author),
                'author.last_name' => get_the_author_meta('last_name', (int) $post->post_author),
                'author.bio' => get_the_author_meta('description', (int) $post->post_author),
                'author.avatar' => function_exists('get_avatar_url')
                    ? (string) get_avatar_url((int) $post->post_author, ['size' => 512])
                    : '',
                default => '',
            };
        }

        if (str_starts_with($token, 'site.')) {
            $site_variables = $this->published_contract()['siteVariables'];
            $logo_id = function_exists('get_theme_mod') ? absint(get_theme_mod('custom_logo', 0)) : 0;
            if (!$logo_id) $logo_id = absint(get_option('kodety_brand_logo_id', 0));
            return match ($token) {
                'site.name' => (string) ($site_variables['name'] ?? get_bloginfo('name')),
                'site.description' => (string) ($site_variables['description'] ?? get_bloginfo('description')),
                'site.url' => (string) ($site_variables['url'] ?? home_url('/')),
                'site.logo' => (string) ($site_variables['logo']
                    ?? ($logo_id ? (wp_get_attachment_image_url($logo_id, 'full') ?: '') : '')),
                default => '',
            };
        }

        if (str_starts_with($token, 'product.')) {
            $thumbnail_id = get_post_thumbnail_id($post);
            $product = function_exists('wc_get_product') ? wc_get_product($post->ID) : null;
            if ($token === 'product.image') {
                $image_id = is_object($product) && method_exists($product, 'get_image_id')
                    ? absint($product->get_image_id())
                    : $thumbnail_id;
                return $image_id ? (string) (wp_get_attachment_image_url($image_id, 'full') ?: '') : '';
            }
            if ($token === 'product.price') {
                if (is_object($product) && method_exists($product, 'get_price_html')) {
                    return wp_strip_all_tags((string) $product->get_price_html());
                }
                return (string) get_post_meta($post->ID, '_price', true);
            }
            if ($token === 'product.sku') {
                return is_object($product) && method_exists($product, 'get_sku')
                    ? (string) $product->get_sku()
                    : (string) get_post_meta($post->ID, '_sku', true);
            }
            return '';
        }

        if (str_starts_with($token, 'category.')) {
            $term = $this->primary_term($post);
            if (!$term instanceof WP_Term) return '';
            return match ($token) {
                'category.name' => $term->name,
                'category.slug' => $term->slug,
                'category.url' => ($url = get_term_link($term)) && !is_wp_error($url) ? (string) $url : '',
                default => '',
            };
        }

        return '';
    }

    public function post_saved(int $post_id, WP_Post $post, bool $update, ?WP_Post $post_before = null): void {
        unset($update, $post_before);
        if ($this->should_queue_post($post_id, $post)) $this->queued_posts[$post_id] = true;
    }

    public function post_status_changed(string $new_status, string $old_status, WP_Post $post): void {
        if ($new_status === $old_status) return;
        if ($new_status === 'publish' && $this->should_queue_post($post->ID, $post)) {
            $this->queued_posts[$post->ID] = true;
        }
    }

    public function post_meta_changed(mixed $meta_id, int $post_id, string $meta_key, mixed $meta_value = null): void {
        unset($meta_id, $meta_value);
        if (isset($this->generating_posts[$post_id])) return;
        if (str_starts_with($meta_key, '_kodety_social_') || in_array($meta_key, ['_edit_lock', '_edit_last'], true)) return;
        $post = get_post($post_id);
        if ($post instanceof WP_Post && $this->should_queue_post($post_id, $post)) $this->queued_posts[$post_id] = true;
    }

    public function post_terms_changed(
        int $object_id,
        mixed $terms = null,
        mixed $term_taxonomy_ids = null,
        string $taxonomy = '',
        bool $append = false,
        mixed $old_term_taxonomy_ids = null
    ): void {
        unset($terms, $term_taxonomy_ids, $taxonomy, $append, $old_term_taxonomy_ids);
        $post = get_post($object_id);
        if ($post instanceof WP_Post && $this->should_queue_post($object_id, $post)) $this->queued_posts[$object_id] = true;
    }

    public function author_updated(int $user_id): void {
        if ($user_id <= 0) return;
        $contract = $this->published_contract();
        if (!$this->contract_valid) return;
        $this->scan_queued_posts([
            'mode' => 'author',
            'after_id' => 0,
            'author_id' => $user_id,
            'contract' => $this->contract_revision($contract),
        ]);
    }

    public function site_option_updated(string $option, mixed $old_value, mixed $value): void {
        unset($old_value, $value);
        $theme_mods = function_exists('get_stylesheet') ? 'theme_mods_' . get_stylesheet() : '';
        if (!in_array($option, [
            'blogname',
            'blogdescription',
            'site_icon',
            'kodety_brand_logo_id',
            'kodety_cms_templates',
            $theme_mods,
        ], true)) return;
        $this->regenerate_all();
    }

    public function queue_post(int $post_id): void {
        $post = get_post($post_id);
        if ($post instanceof WP_Post && $this->should_queue_post($post_id, $post)) $this->queued_posts[$post_id] = true;
    }

    /**
     * Remove only the generated attachment owned by a post before WordPress
     * permanently deletes that post. Deleting an attachment directly also
     * clears a matching source assignment without touching user-owned media.
     */
    public function before_delete_post(int $post_id, ?WP_Post $post = null): void {
        if ($post_id <= 0) return;
        $post = $post instanceof WP_Post ? $post : get_post($post_id);
        if (!$post instanceof WP_Post) return;
        unset($this->queued_posts[$post_id], $this->generating_posts[$post_id]);

        if ($post->post_type === 'attachment') {
            if (get_post_meta($post_id, self::META_GENERATED, true) !== '1') return;
            $source_post_id = absint(get_post_meta($post_id, self::META_SOURCE_POST, true));
            if ($source_post_id <= 0
                || absint(get_post_meta($source_post_id, self::META_ATTACHMENT, true)) !== $post_id) return;
            $this->clear_source_assignment($source_post_id);
            $this->invalidate_post_cache($source_post_id);
            return;
        }

        $this->delete_generated_image_for_post($post_id);
        $this->release_lock($post_id);
    }

    /** Convert the request-local dirty set into bounded, debounced cron batches. */
    public function flush_queue(): void {
        if (!Kodety_Edition::has('socialImageBuilder')) {
            $this->queued_posts = [];
            return;
        }
        if (!$this->queued_posts) return;
        $post_ids = array_keys($this->queued_posts);
        $this->queued_posts = [];
        $this->schedule_generation_batches($post_ids);
    }

    /**
     * Process one bounded worker payload. An integer remains accepted for cron
     * events created by older Onun Kodety versions during a rolling upgrade.
     */
    public function generate_queued(mixed $payload): void {
        if (!Kodety_Edition::has('socialImageBuilder')) return;
        $attempt = is_array($payload) ? max(0, min(self::MAX_GENERATION_RETRIES, (int) ($payload['attempt'] ?? 0))) : 0;
        $post_ids = is_array($payload) && isset($payload['post_ids']) && is_array($payload['post_ids'])
            ? $payload['post_ids']
            : (is_array($payload) ? $payload : [$payload]);
        $post_ids = $this->bounded_post_ids($post_ids, self::SCAN_BATCH_SIZE);
        if (!$post_ids) return;

        $remaining = array_slice($post_ids, self::GENERATION_BATCH_SIZE);
        $post_ids = array_slice($post_ids, 0, self::GENERATION_BATCH_SIZE);
        if ($remaining) $this->schedule_generation_batches($remaining, $attempt);

        $retry_ids = [];
        foreach ($post_ids as $post_id) {
            $result = $this->generate_for_post($post_id);
            if (!is_wp_error($result)) continue;
            error_log('[Onun Kodety] Imagem social do conteúdo ' . $post_id . ': ' . $result->get_error_message());
            if ($attempt < self::MAX_GENERATION_RETRIES && $this->is_retryable_generation_error($result)) {
                $retry_ids[] = $post_id;
            }
        }
        if ($retry_ids && function_exists('wp_schedule_single_event')) {
            $delay = min(3600, self::RETRY_BASE_DELAY * (2 ** $attempt));
            $this->schedule_generation_batches($retry_ids, $attempt + 1, $delay);
        }
    }

    /**
     * Begin a cursor-based scan of every published item that currently resolves
     * to a social template. Each request scans at most SCAN_BATCH_SIZE records;
     * subsequent pages and generation work continue through bounded cron jobs.
     * The return value is the number queued from the first page.
     */
    public function regenerate_all(string $release = ''): int {
        unset($release);
        if (!Kodety_Edition::has('socialImageBuilder')) return 0;
        $this->contract_cache = null;
        $this->contract_revision_cache = '';
        $contract = $this->published_contract();
        if (!$this->contract_valid) return 0;
        $revision = $this->contract_revision($contract);
        $this->cleanup_stale_generated_images($revision);
        if (!$contract['siteTemplate'] && !$contract['pageTemplates'] && !$contract['postTypeTemplates']) return 0;
        return $this->scan_queued_posts([
            'mode' => 'regenerate',
            'after_id' => 0,
            'contract' => $revision,
        ]);
    }

    /**
     * Continue a regeneration, author or stale-assignment scan. The compact
     * cursor payload keeps the cron option bounded even on very large sites.
     */
    public function scan_queued_posts(mixed $payload): int {
        if (!Kodety_Edition::has('socialImageBuilder')) return 0;
        $payload = is_array($payload) ? $payload : [];
        $mode = in_array(($payload['mode'] ?? ''), ['regenerate', 'author', 'stale'], true)
            ? (string) $payload['mode']
            : 'regenerate';
        $after_id = max(0, (int) ($payload['after_id'] ?? 0));
        $page = max(1, min(1_000_000, (int) ($payload['page'] ?? 1)));
        $author_id = max(0, (int) ($payload['author_id'] ?? 0));
        $contract = $this->published_contract();
        if (!$this->contract_valid) return 0;
        $revision = $this->contract_revision($contract);
        if (isset($payload['contract'])
            && is_string($payload['contract'])
            && $payload['contract'] !== ''
            && !hash_equals($revision, $payload['contract'])) return 0;

        $post_types = $this->social_post_types($contract);
        if ($mode !== 'stale' && !$post_types) return 0;
        $ids = $this->scan_post_ids($mode, $after_id, $post_types, $author_id, $page);
        if (!$ids) return 0;

        $queued = [];
        foreach ($ids as $post_id) {
            $post = get_post($post_id);
            if ($mode === 'stale') {
                if ($post instanceof WP_Post && $this->template_for_post($post)) continue;
                $this->delete_generated_image_for_post($post_id);
                continue;
            }
            if ($post instanceof WP_Post && $this->should_queue_post($post_id, $post)) $queued[] = $post_id;
        }
        if ($queued) $this->schedule_generation_batches($queued);

        if (count($ids) >= self::SCAN_BATCH_SIZE) {
            $next = [
                'mode' => $mode,
                'after_id' => max($ids),
                'page' => $page + 1,
                'contract' => $revision,
            ];
            if ($mode === 'author') $next['author_id'] = $author_id;
            $this->schedule_scan($next);
        }
        return count($queued);
    }

    /**
     * Remove stale generated assignments in cursor batches. A changed template
     * is retained until its replacement succeeds; apply_to_html() will not
     * expose the stale attachment in the meantime.
     */
    private function cleanup_stale_generated_images(string $revision): void {
        $this->scan_queued_posts([
            'mode' => 'stale',
            'after_id' => 0,
            'contract' => $revision,
        ]);
    }

    /** @return array<int,string> */
    private function social_post_types(array $contract): array {
        $post_types = array_keys((array) ($contract['postTypeTemplates'] ?? []));
        if (!empty($contract['pageTemplates'])) $post_types[] = 'page';
        $cms_templates = class_exists('Kodety_Plugin')
            ? Kodety_Plugin::instance()->project_cms_option('kodety_cms_templates', [])
            : get_option('kodety_cms_templates', []);
        foreach ((array) $cms_templates as $post_type => $path) {
            if (isset($contract['pageTemplates'][self::path((string) $path)])) {
                $post_types[] = self::key((string) $post_type);
            }
        }
        if (!empty($contract['siteTemplate']) && function_exists('get_post_types')) {
            $post_types = array_merge($post_types, array_values((array) get_post_types(['public' => true], 'names')));
        }
        $sanitized = [];
        foreach ($post_types as $post_type) {
            $post_type = self::key((string) $post_type);
            if ($post_type === '' || $post_type === 'attachment') continue;
            $sanitized[$post_type] = $post_type;
            // A valid WordPress install should never approach this bound. It
            // prevents a corrupted contract from producing an oversized query.
            if (count($sanitized) >= 200) break;
        }
        return array_values($sanitized);
    }

    private function contract_revision(array $contract): string {
        if ($this->contract_cache !== null && $this->contract_revision_cache !== '') {
            return $this->contract_revision_cache;
        }
        return self::hash_contract($contract);
    }

    private static function hash_contract(array $contract): string {
        $encoded = function_exists('wp_json_encode')
            ? wp_json_encode($contract)
            : json_encode($contract, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        return hash('sha256', is_string($encoded) ? $encoded : '');
    }

    /**
     * Query a stable ID cursor rather than using a numeric offset. The wpdb
     * branch is the normal WordPress path; get_posts() is retained for isolated
     * runtimes and tests where the database abstraction is unavailable.
     *
     * @param array<int,string> $post_types
     * @return array<int,int>
     */
    private function scan_post_ids(
        string $mode,
        int $after_id,
        array $post_types,
        int $author_id,
        int $page
    ): array {
        global $wpdb;
        if (is_object($wpdb)
            && isset($wpdb->posts, $wpdb->postmeta)
            && method_exists($wpdb, 'prepare')
            && method_exists($wpdb, 'get_col')) {
            $arguments = [$after_id];
            if ($mode === 'stale') {
                $sql = "SELECT DISTINCT p.ID
                    FROM {$wpdb->posts} p
                    INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID
                    WHERE p.ID > %d
                      AND p.post_type <> 'attachment'
                      AND pm.meta_key = %s
                    ORDER BY p.ID ASC
                    LIMIT %d";
                $arguments[] = self::META_ATTACHMENT;
                $arguments[] = self::SCAN_BATCH_SIZE;
            } else {
                $placeholders = implode(',', array_fill(0, count($post_types), '%s'));
                $sql = "SELECT p.ID
                    FROM {$wpdb->posts} p
                    WHERE p.ID > %d
                      AND p.post_status = 'publish'
                      AND p.post_type IN ({$placeholders})";
                $arguments = array_merge($arguments, $post_types);
                if ($mode === 'author') {
                    $sql .= ' AND p.post_author = %d';
                    $arguments[] = $author_id;
                }
                $sql .= ' ORDER BY p.ID ASC LIMIT %d';
                $arguments[] = self::SCAN_BATCH_SIZE;
            }
            $prepared = $wpdb->prepare($sql, ...$arguments);
            $ids = is_string($prepared) ? $wpdb->get_col($prepared) : [];
            return $this->bounded_post_ids((array) $ids, self::SCAN_BATCH_SIZE);
        }

        if (!function_exists('get_posts')) return [];
        $arguments = [
            'post_type' => $mode === 'stale' ? 'any' : $post_types,
            'post_status' => $mode === 'stale' ? 'any' : 'publish',
            'numberposts' => self::SCAN_BATCH_SIZE,
            'posts_per_page' => self::SCAN_BATCH_SIZE,
            'fields' => 'ids',
            'orderby' => 'ID',
            'order' => 'ASC',
            'paged' => $page,
            'offset' => ($page - 1) * self::SCAN_BATCH_SIZE,
            'no_found_rows' => true,
            'suppress_filters' => true,
            'cache_results' => false,
            'update_post_meta_cache' => false,
            'update_post_term_cache' => false,
        ];
        if ($mode === 'stale') $arguments['meta_key'] = self::META_ATTACHMENT;
        if ($mode === 'author') $arguments['author'] = $author_id;
        $ids = array_values(array_filter(
            $this->bounded_post_ids((array) get_posts($arguments), self::SCAN_BATCH_SIZE * 2),
            static fn(int $post_id): bool => $post_id > $after_id
        ));
        sort($ids, SORT_NUMERIC);
        return array_slice($ids, 0, self::SCAN_BATCH_SIZE);
    }

    /** @return array<int,int> */
    private function bounded_post_ids(array $values, int $limit): array {
        $ids = [];
        foreach ($values as $value) {
            $post_id = absint($value);
            if ($post_id <= 0) continue;
            $ids[$post_id] = $post_id;
            if (count($ids) >= $limit) break;
        }
        return array_values($ids);
    }

    private function schedule_scan(array $payload, int $delay = 0): bool {
        $payload = [
            'mode' => in_array(($payload['mode'] ?? ''), ['regenerate', 'author', 'stale'], true)
                ? (string) $payload['mode']
                : 'regenerate',
            'after_id' => max(0, (int) ($payload['after_id'] ?? 0)),
            'page' => max(1, min(1_000_000, (int) ($payload['page'] ?? 1))),
            'contract' => substr((string) ($payload['contract'] ?? ''), 0, 64),
        ] + (($payload['mode'] ?? '') === 'author'
            ? ['author_id' => max(0, (int) ($payload['author_id'] ?? 0))]
            : []);
        $args = [$payload];
        if (function_exists('wp_next_scheduled') && wp_next_scheduled(self::SCAN_CRON_HOOK, $args)) {
            $this->request_cron_dispatch();
            return true;
        }
        if (!function_exists('wp_schedule_single_event')) return false;
        $scheduled = wp_schedule_single_event(time() + max(0, $delay), self::SCAN_CRON_HOOK, $args, true);
        if (is_wp_error($scheduled)) {
            error_log('[Onun Kodety] Não foi possível continuar a varredura de imagens sociais: ' . $scheduled->get_error_message());
            return false;
        }
        if ($scheduled !== false) $this->request_cron_dispatch();
        return $scheduled !== false;
    }

    /**
     * Schedule compact chains of at most SCAN_BATCH_SIZE IDs. Each callback
     * renders only GENERATION_BATCH_SIZE items and hands the bounded remainder
     * to the next callback, avoiding hundreds of simultaneously due events.
     * Core duplicate checks plus the per-post lock make concurrent dispatch safe.
     */
    private function schedule_generation_batches(array $post_ids, int $attempt = 0, int $delay = 0): int {
        $batch = [];
        $scheduled_count = 0;
        foreach ($post_ids as $value) {
            $post_id = absint($value);
            if ($post_id <= 0 || in_array($post_id, $batch, true)) continue;
            $batch[] = $post_id;
            if (count($batch) < self::SCAN_BATCH_SIZE) continue;
            if ($this->schedule_generation_batch($batch, $attempt, $delay)) $scheduled_count += count($batch);
            $batch = [];
        }
        if ($batch && $this->schedule_generation_batch($batch, $attempt, $delay)) $scheduled_count += count($batch);
        return $scheduled_count;
    }

    /** @param array<int,int> $post_ids */
    private function schedule_generation_batch(array $post_ids, int $attempt, int $delay): bool {
        $payload = [
            'post_ids' => $this->bounded_post_ids($post_ids, self::SCAN_BATCH_SIZE),
            'attempt' => max(0, min(self::MAX_GENERATION_RETRIES, $attempt)),
        ];
        if (!$payload['post_ids']) return false;
        $args = [$payload];
        if (function_exists('wp_next_scheduled') && wp_next_scheduled(self::CRON_HOOK, $args)) {
            $this->request_cron_dispatch();
            return true;
        }
        if (function_exists('wp_schedule_single_event')) {
            $scheduled = wp_schedule_single_event(time() + max(0, $delay), self::CRON_HOOK, $args, true);
            if (is_wp_error($scheduled)) {
                error_log('[Onun Kodety] Não foi possível enfileirar um lote de imagens sociais: ' . $scheduled->get_error_message());
                return false;
            }
            if ($scheduled !== false) $this->request_cron_dispatch();
            return $scheduled !== false;
        }
        // Isolated/non-standard runtimes retain functional behavior. WordPress
        // always reaches the asynchronous branch above.
        $this->generate_queued($payload);
        return true;
    }

    private function request_cron_dispatch(): void {
        $this->cron_dispatch_pending = true;
    }

    /**
     * WordPress' native spawn is non-blocking. Running once at shutdown makes a
     * just-scheduled current-time event progress even on otherwise idle sites.
     * Sites with DISABLE_WP_CRON use their configured system cron as expected.
     */
    public function dispatch_scheduled_cron(): void {
        if (!$this->cron_dispatch_pending || $this->cron_dispatched) return;
        $this->cron_dispatch_pending = false;
        $this->cron_dispatched = true;
        if ((defined('DISABLE_WP_CRON') && DISABLE_WP_CRON) || !function_exists('spawn_cron')) return;
        spawn_cron(microtime(true));
    }

    private function is_retryable_generation_error(WP_Error $error): bool {
        return !in_array($error->get_error_code(), [
            'kodety_social_post_missing',
            'kodety_social_template_missing',
        ], true);
    }

    private function clear_source_assignment(int $post_id): void {
        delete_post_meta($post_id, self::META_ATTACHMENT);
        delete_post_meta($post_id, self::META_HASH);
        delete_post_meta($post_id, self::META_TEMPLATE);
        delete_post_meta($post_id, self::META_ERROR);
    }

    private function delete_generated_image_for_post(int $post_id): void {
        $attachment_id = absint(get_post_meta($post_id, self::META_ATTACHMENT, true));
        $attachment = $attachment_id > 0 ? get_post($attachment_id) : null;
        $owned = $attachment instanceof WP_Post
            && $attachment->post_type === 'attachment'
            && get_post_meta($attachment_id, self::META_GENERATED, true) === '1'
            && absint(get_post_meta($attachment_id, self::META_SOURCE_POST, true)) === $post_id;
        if ($owned && function_exists('wp_delete_attachment')) wp_delete_attachment($attachment_id, true);
        $this->clear_source_assignment($post_id);
        $this->invalidate_post_cache($post_id);
    }

    /**
     * clean_post_cache() is the standard invalidation signal consumed by core
     * and page-cache integrations. No cache-plugin-specific APIs are assumed.
     */
    private function invalidate_post_cache(int $post_id, int $attachment_id = 0): void {
        if ($attachment_id > 0 && function_exists('clean_attachment_cache')) {
            clean_attachment_cache($attachment_id);
        }
        if (function_exists('clean_post_cache')) {
            clean_post_cache($post_id);
        } elseif (function_exists('wp_cache_delete')) {
            wp_cache_delete($post_id, 'posts');
            wp_cache_delete($post_id, 'post_meta');
        }
    }

    /** Render, atomically persist, register and assign one generated PNG. */
    public function generate_for_post(int $post_id): int|WP_Error {
        if (!Kodety_Edition::has('socialImageBuilder')) {
            return new WP_Error(
                'kodety_license_social_image_required',
                'Ative uma licença Onun Kodety para gerar Social Images.',
                ['status' => 403, 'licenseUrl' => Kodety_Edition::license_url()]
            );
        }
        if (!extension_loaded('gd')
            || !function_exists('imagecreatetruecolor')
            || !function_exists('imagepng')) {
            return $this->generation_error($post_id, 'kodety_social_gd_missing', 'A extensão GD do PHP é necessária para gerar imagens sociais.');
        }
        $post = get_post($post_id);
        if (!$post instanceof WP_Post || $post->post_status !== 'publish') {
            return $this->generation_error($post_id, 'kodety_social_post_missing', 'O conteúdo publicado não foi encontrado.');
        }
        $template = $this->template_for_post($post);
        if (!$template) return $this->generation_error($post_id, 'kodety_social_template_missing', 'Nenhum template de imagem social está atribuído a este conteúdo.');
        if (!$this->acquire_lock($post_id)) {
            return new WP_Error('kodety_social_locked', 'A imagem social deste conteúdo já está sendo gerada.');
        }

        $this->generating_posts[$post_id] = true;
        $image = null;
        $temporary = '';
        $target = '';
        $new_attachment_id = 0;
        $source_assignment_started = false;
        $previous_assignment = [];
        try {
            $hash = $this->render_hash($template, $post);
            $current_hash = (string) get_post_meta($post_id, self::META_HASH, true);
            $current_attachment = absint(get_post_meta($post_id, self::META_ATTACHMENT, true));
            $previous_assignment = [
                self::META_ATTACHMENT => $current_attachment > 0 ? $current_attachment : '',
                self::META_HASH => $current_hash,
                self::META_TEMPLATE => (string) get_post_meta($post_id, self::META_TEMPLATE, true),
            ];
            if ($current_hash !== '' && hash_equals($current_hash, $hash)
                && $this->generated_attachment_is_valid($current_attachment, $post_id)) {
                delete_post_meta($post_id, self::META_ERROR);
                return $current_attachment;
            }

            $rendered = $this->render_template($template, $post);
            if (is_wp_error($rendered)) return $this->generation_error($post_id, $rendered->get_error_code(), $rendered->get_error_message());
            $image = $rendered;

            $uploads = wp_upload_dir();
            if (!empty($uploads['error']) || empty($uploads['basedir']) || empty($uploads['baseurl'])) {
                return $this->generation_error($post_id, 'kodety_social_uploads', 'O diretório de uploads do WordPress não está disponível.');
            }
            if (function_exists('upload_is_user_over_quota') && upload_is_user_over_quota()) {
                return $this->generation_error($post_id, 'kodety_social_quota', 'A cota de armazenamento do site foi atingida.');
            }
            $directory = trailingslashit((string) $uploads['basedir']) . 'kodety/social';
            if (!wp_mkdir_p($directory) && !is_dir($directory)) {
                return $this->generation_error($post_id, 'kodety_social_directory', 'Não foi possível criar o diretório das imagens sociais.');
            }
            $filename = 'post-' . $post_id . '-' . substr($hash, 0, 16) . '.png';
            $target = $directory . '/' . $filename;
            $temporary = tempnam($directory, '.kodety-social-');
            if (!is_string($temporary) || $temporary === '') {
                return $this->generation_error($post_id, 'kodety_social_temporary', 'Não foi possível preparar o arquivo temporário da imagem social.');
            }
            $filters = defined('PNG_ALL_FILTERS') ? PNG_ALL_FILTERS : -1;
            if (!imagepng($image, $temporary, 7, $filters)) {
                return $this->generation_error($post_id, 'kodety_social_encode', 'Não foi possível codificar a imagem social.');
            }
            @chmod($temporary, 0644 & ~umask());
            if (is_file($target)) {
                @unlink($temporary);
                $temporary = '';
            } elseif (!rename($temporary, $target)) {
                return $this->generation_error($post_id, 'kodety_social_activate', 'Não foi possível ativar a imagem social gerada.');
            } else {
                $temporary = '';
            }

            $new_attachment_id = wp_insert_attachment([
                'post_mime_type' => 'image/png',
                'post_title' => sanitize_text_field('Social Image — ' . get_the_title($post)),
                'post_status' => 'inherit',
                'post_parent' => $post_id,
            ], $target, $post_id, true);
            if (is_wp_error($new_attachment_id)) {
                @unlink($target);
                $target = '';
                return $this->generation_error($post_id, 'kodety_social_attachment', $new_attachment_id->get_error_message());
            }
            $new_attachment_id = (int) $new_attachment_id;
            if ($new_attachment_id <= 0) {
                throw new RuntimeException('O WordPress não confirmou o novo attachment.');
            }
            $this->assert_attachment_record_checkpoint($new_attachment_id, $post_id);
            if (!function_exists('wp_generate_attachment_metadata')) require_once ABSPATH . 'wp-admin/includes/image.php';
            $attachment_metadata = wp_generate_attachment_metadata($new_attachment_id, $target);
            if (!is_array($attachment_metadata)) {
                throw new RuntimeException('O WordPress não gerou os metadados do novo attachment.');
            }
            wp_update_attachment_metadata($new_attachment_id, $attachment_metadata);
            $alt = sanitize_text_field(get_the_title($post));
            $attachment_state = [
                self::META_GENERATED => '1',
                self::META_SOURCE_POST => $post_id,
                self::META_HASH => $hash,
                '_wp_attachment_image_alt' => $alt,
            ];
            foreach ($attachment_state as $meta_key => $meta_value) {
                update_post_meta($new_attachment_id, $meta_key, $meta_value);
            }
            $this->assert_generated_attachment_checkpoint(
                $new_attachment_id,
                $post_id,
                $target,
                $hash,
                (string) $template['id'],
                $alt,
                (int) ($template['width'] ?? 0),
                (int) ($template['height'] ?? 0)
            );

            // Keep the public attachment pointer last. Hash and template must
            // be acknowledged by readback while the old attachment is still
            // the active assignment.
            $source_assignment_started = true;
            update_post_meta($post_id, self::META_HASH, $hash);
            update_post_meta($post_id, self::META_TEMPLATE, (string) $template['id']);
            $this->assert_source_metadata_checkpoint(
                $post_id,
                $hash,
                (string) $template['id']
            );
            update_post_meta($post_id, self::META_ATTACHMENT, $new_attachment_id);
            delete_post_meta($post_id, self::META_ERROR);
            $this->assert_source_assignment_checkpoint(
                $post_id,
                $new_attachment_id,
                $hash,
                (string) $template['id']
            );

            // The new file, metadata, ownership and source assignment are all
            // confirmed. Only now may the previous generated attachment leave.
            if ($current_attachment > 0 && $current_attachment !== $new_attachment_id
                && get_post_meta($current_attachment, self::META_GENERATED, true) === '1'
                && absint(get_post_meta($current_attachment, self::META_SOURCE_POST, true)) === $post_id) {
                try {
                    wp_delete_attachment($current_attachment, true);
                } catch (Throwable $cleanup_error) {
                    error_log('[Onun Kodety Social Images] Attachment anterior #' . $current_attachment . ' não pôde ser removido: ' . $cleanup_error->getMessage());
                }
            }
            try {
                $this->invalidate_post_cache($post_id, $new_attachment_id);
            } catch (Throwable $cache_error) {
                error_log('[Onun Kodety Social Images] Cache não pôde ser invalidado para o post #' . $post_id . ': ' . $cache_error->getMessage());
            }
            return $new_attachment_id;
        } catch (Throwable $error) {
            if ($source_assignment_started && $previous_assignment) {
                $this->restore_source_assignment($post_id, $previous_assignment);
            }
            $this->discard_unconfirmed_attachment($new_attachment_id, $target);
            return $this->generation_error($post_id, 'kodety_social_generation_failed', $error->getMessage());
        } finally {
            if ($image && (is_resource($image) || $image instanceof GdImage)) imagedestroy($image);
            if ($temporary !== '' && is_file($temporary)) @unlink($temporary);
            unset($this->generating_posts[$post_id]);
            $this->release_lock($post_id);
        }
    }

    private function assert_attachment_record_checkpoint(int $attachment_id, int $post_id): void {
        $attachment = get_post($attachment_id);
        if (!$attachment instanceof WP_Post
            || $attachment->post_type !== 'attachment'
            || (int) $attachment->post_parent !== $post_id
            || !wp_attachment_is_image($attachment_id)
            || (string) get_post_mime_type($attachment_id) !== 'image/png') {
            throw new RuntimeException('O registro do novo attachment não foi confirmado.');
        }
    }

    private function assert_generated_attachment_checkpoint(
        int $attachment_id,
        int $post_id,
        string $target,
        string $hash,
        string $template_id,
        string $alt,
        int $expected_width,
        int $expected_height
    ): void {
        $this->assert_attachment_record_checkpoint($attachment_id, $post_id);
        $stored_file = get_attached_file($attachment_id);
        if (!is_string($stored_file)
            || $stored_file === ''
            || !is_file($stored_file)
            || is_link($stored_file)
            || realpath($stored_file) !== realpath($target)
            || !$this->path_in_allowed_root($stored_file)) {
            throw new RuntimeException('O arquivo do novo attachment não foi confirmado.');
        }
        $metadata = wp_get_attachment_metadata($attachment_id);
        if (!is_array($metadata)
            || absint($metadata['width'] ?? 0) !== $expected_width
            || absint($metadata['height'] ?? 0) !== $expected_height
            || basename((string) ($metadata['file'] ?? '')) !== basename($target)) {
            throw new RuntimeException('Os metadados do novo attachment não foram confirmados.');
        }
        $expected_meta = [
            self::META_GENERATED => '1',
            self::META_SOURCE_POST => (string) $post_id,
            self::META_HASH => $hash,
            '_wp_attachment_image_alt' => $alt,
        ];
        foreach ($expected_meta as $meta_key => $expected_value) {
            if ((string) get_post_meta($attachment_id, $meta_key, true) !== $expected_value) {
                throw new RuntimeException('O meta ' . $meta_key . ' do novo attachment não foi confirmado.');
            }
        }
        if ($template_id === '') {
            throw new RuntimeException('A identidade do template da imagem social está vazia.');
        }
    }

    private function assert_source_metadata_checkpoint(
        int $post_id,
        string $hash,
        string $template_id
    ): void {
        if ((string) get_post_meta($post_id, self::META_HASH, true) !== $hash
            || (string) get_post_meta($post_id, self::META_TEMPLATE, true) !== $template_id) {
            throw new RuntimeException('O hash e o template da imagem social não foram confirmados no conteúdo.');
        }
    }

    private function assert_source_assignment_checkpoint(
        int $post_id,
        int $attachment_id,
        string $hash,
        string $template_id
    ): void {
        if (absint(get_post_meta($post_id, self::META_ATTACHMENT, true)) !== $attachment_id
            || (string) get_post_meta($post_id, self::META_HASH, true) !== $hash
            || (string) get_post_meta($post_id, self::META_TEMPLATE, true) !== $template_id
            || (string) get_post_meta($post_id, self::META_ERROR, true) !== ''
            || !$this->generated_attachment_is_valid($attachment_id, $post_id)) {
            throw new RuntimeException('O novo estado da imagem social não foi confirmado no conteúdo.');
        }
    }

    /** @param array<string,int|string> $assignment */
    private function restore_source_assignment(int $post_id, array $assignment): void {
        foreach ([self::META_HASH, self::META_TEMPLATE, self::META_ATTACHMENT] as $meta_key) {
            $value = $assignment[$meta_key] ?? '';
            if ($value === '' || $value === 0) {
                delete_post_meta($post_id, $meta_key);
            } else {
                update_post_meta($post_id, $meta_key, $value);
            }
        }
    }

    private function discard_unconfirmed_attachment(int $attachment_id, string $target): void {
        if ($attachment_id > 0 && function_exists('wp_delete_attachment')) {
            try {
                wp_delete_attachment($attachment_id, true);
            } catch (Throwable $cleanup_error) {
                error_log('[Onun Kodety Social Images] Attachment novo #' . $attachment_id . ' não pôde ser removido: ' . $cleanup_error->getMessage());
            }
        }
        if ($target !== '' && is_file($target)) @unlink($target);
    }

    private function generated_attachment_is_valid(int $attachment_id, int $post_id): bool {
        if ($attachment_id <= 0
            || !wp_attachment_is_image($attachment_id)
            || get_post_meta($attachment_id, self::META_GENERATED, true) !== '1'
            || absint(get_post_meta($attachment_id, self::META_SOURCE_POST, true)) !== $post_id
            || !function_exists('get_attached_file')) return false;
        $file = get_attached_file($attachment_id);
        return is_string($file)
            && is_file($file)
            && !is_link($file)
            && $this->path_in_allowed_root($file);
    }

    /** @return array{version:int,templates:array,siteTemplate:?string,pageTemplates:array,postTypeTemplates:array,siteVariables:array,pageVariables:array} */
    private static function empty_contract(): array {
        return [
            'version' => self::CONTRACT_VERSION,
            'templates' => [],
            'siteTemplate' => null,
            'pageTemplates' => [],
            'postTypeTemplates' => [],
            'siteVariables' => [],
            'pageVariables' => [],
        ];
    }

    private static function contract_from_metadata(array $metadata): array {
        $social = is_array($metadata['socialImages'] ?? null) ? $metadata['socialImages'] : [];
        $site_settings = is_array($metadata['siteSettings'] ?? null) ? $metadata['siteSettings'] : [];
        $uses_template_library = array_key_exists('socialImageTemplates', $site_settings)
            && is_array($site_settings['socialImageTemplates']);
        // The editor stores the canonical catalog inside siteSettings. A
        // top-level catalog is still accepted for projects created during the
        // early library prototype. Canonical entries win on ID collisions.
        $library = self::template_library(
            $site_settings['socialImageTemplates'] ?? [],
            $metadata['socialImageTemplates'] ?? []
        );
        $site_settings_are_authoritative = $uses_template_library
            || array_key_exists('socialImageTemplateId', $site_settings)
            || array_key_exists('socialImageTemplate', $site_settings);
        $site_reference = $site_settings_are_authoritative
            ? ($site_settings['socialImageTemplateId'] ?? null)
            : ($metadata['socialImageTemplateId'] ?? $social['siteTemplateId'] ?? null);
        $site_legacy_candidate = $site_settings_are_authoritative
            ? ($site_settings['socialImageTemplate'] ?? null)
            : (
                $metadata['socialImageTemplate']
                ?? $social['siteTemplate']
                ?? $social['site']
                ?? null
            );
        $site_candidate = self::resolve_template_assignment(
            $site_reference,
            $site_legacy_candidate,
            $library
        );
        $templates = [];
        $site = self::register_contract_template($templates, $site_candidate);
        $site_variables = self::sanitize_site_variables($site_settings, (string) ($metadata['name'] ?? ''));

        $pages = [];
        $page_variables = [];
        $canonical_page_assignments = [];
        foreach ((array) ($metadata['pageSettings'] ?? []) as $path => $settings) {
            if (!is_array($settings)) continue;
            $clean_path = self::path((string) $path);
            if ($clean_path === '') continue;
            $variables = self::sanitize_page_variables($settings);
            if ($variables) $page_variables[$clean_path] = $variables;
            if (array_key_exists('socialImageTemplateId', $settings)
                || array_key_exists('socialImageTemplate', $settings)) {
                $canonical_page_assignments[$clean_path] = true;
                $template = self::resolve_template_assignment(
                    $settings['socialImageTemplateId'] ?? null,
                    $settings['socialImageTemplate'] ?? null,
                    $library
                );
                $template_id = self::register_contract_template($templates, $template);
                if ($template_id !== null) $pages[$clean_path] = $template_id;
            }
        }
        if (!$uses_template_library) {
            foreach ((array) ($social['pageTemplates'] ?? $social['pages'] ?? []) as $path => $candidate) {
                $clean_path = self::path((string) $path);
                if ($clean_path === '' || isset($canonical_page_assignments[$clean_path])) continue;
                $template = self::resolve_template_candidate($candidate, $library);
                $template_id = self::register_contract_template($templates, $template);
                if ($template_id !== null) $pages[$clean_path] = $template_id;
            }
        }

        $post_types = [];
        $raw_post_types = $uses_template_library
            ? []
            : (
                $social['postTypeTemplates']
                ?? $social['postTypes']
                ?? $metadata['socialImagePostTypeTemplates']
                ?? []
            );
        foreach ((array) $raw_post_types as $post_type => $candidate) {
            $clean_type = self::key((string) $post_type);
            if ($clean_type === '') continue;
            $template = self::resolve_template_candidate($candidate, $library);
            $template_id = self::register_contract_template($templates, $template);
            if ($template_id !== null) $post_types[$clean_type] = $template_id;
        }

        return [
            'version' => self::CONTRACT_VERSION,
            'templates' => $templates,
            'siteTemplate' => $site,
            'pageTemplates' => $pages,
            'postTypeTemplates' => $post_types,
            'siteVariables' => $site_variables,
            'pageVariables' => $page_variables,
        ];
    }

    private static function sanitize_public_contract(array $raw): array {
        // Accept the normalized projection and the authoring metadata shape so
        // hand-built/older releases degrade safely rather than becoming fatal.
        if (!array_key_exists('siteTemplate', $raw)
            && !array_key_exists('pageTemplates', $raw)
            && !array_key_exists('postTypeTemplates', $raw)) {
            return self::contract_from_metadata($raw);
        }
        // Version 2 stores one catalog and cheap assignment IDs. Version 1
        // embedded a full template under every path; normalize both into the
        // compact in-memory representation to keep large CMS sites bounded.
        $templates = self::template_library($raw['templates'] ?? []);
        $site = self::normalize_contract_assignment(
            $raw['siteTemplate'] ?? null,
            $templates
        );
        $pages = [];
        foreach ((array) ($raw['pageTemplates'] ?? []) as $path => $candidate) {
            $clean_path = self::path((string) $path);
            if ($clean_path === '') continue;
            $template_id = self::normalize_contract_assignment($candidate, $templates);
            if ($template_id !== null) $pages[$clean_path] = $template_id;
        }
        $post_types = [];
        foreach ((array) ($raw['postTypeTemplates'] ?? []) as $post_type => $candidate) {
            $clean_type = self::key((string) $post_type);
            if ($clean_type === '') continue;
            $template_id = self::normalize_contract_assignment($candidate, $templates);
            if ($template_id !== null) $post_types[$clean_type] = $template_id;
        }
        $site_variables = self::sanitize_site_variables($raw['siteVariables'] ?? []);
        $page_variables = [];
        foreach ((array) ($raw['pageVariables'] ?? []) as $path => $candidate) {
            $clean_path = self::path((string) $path);
            $variables = self::sanitize_page_variables($candidate);
            if ($clean_path !== '' && $variables) $page_variables[$clean_path] = $variables;
        }
        return [
            'version' => self::CONTRACT_VERSION,
            'templates' => $templates,
            'siteTemplate' => $site,
            'pageTemplates' => $pages,
            'postTypeTemplates' => $post_types,
            'siteVariables' => $site_variables,
            'pageVariables' => $page_variables,
        ];
    }

    private static function sanitize_site_variables(mixed $candidate, string $fallback_name = ''): array {
        $candidate = is_array($candidate) ? $candidate : [];
        $values = [
            'name' => self::first_variable_value([$candidate['name'] ?? null, $candidate['siteTitle'] ?? null, $fallback_name]),
            'description' => self::first_variable_value([$candidate['description'] ?? null]),
            'url' => self::first_variable_value([$candidate['url'] ?? null, $candidate['baseUrl'] ?? null]),
            'logo' => self::first_variable_value([
                $candidate['logo'] ?? null,
                $candidate['faviconLight'] ?? null,
                $candidate['faviconDark'] ?? null,
            ]),
        ];
        return self::sanitize_variable_values($values, [
            'name' => 500,
            'description' => 4000,
            'url' => 2048,
            'logo' => 2048,
        ]);
    }

    private static function sanitize_page_variables(mixed $candidate): array {
        $candidate = is_array($candidate) ? $candidate : [];
        $values = [
            'title' => self::first_variable_value([
                $candidate['resolvedTitle'] ?? null,
                $candidate['socialTitle'] ?? null,
                $candidate['title'] ?? null,
            ]),
            'excerpt' => self::first_variable_value([
                $candidate['resolvedExcerpt'] ?? null,
                $candidate['socialDescription'] ?? null,
                $candidate['excerpt'] ?? null,
                $candidate['description'] ?? null,
            ]),
            'url' => self::first_variable_value([$candidate['url'] ?? null, $candidate['canonicalUrl'] ?? null]),
        ];
        return self::sanitize_variable_values($values, [
            'title' => 2000,
            'excerpt' => 8000,
            'url' => 2048,
        ]);
    }

    private static function first_variable_value(array $candidates): string {
        foreach ($candidates as $candidate) {
            if (!is_scalar($candidate)) continue;
            $value = trim((string) $candidate);
            if ($value !== '') return $value;
        }
        return '';
    }

    private static function sanitize_variable_values(array $values, array $limits): array {
        $clean = [];
        foreach ($limits as $key => $limit) {
            $value = $values[$key] ?? '';
            if (!is_scalar($value)) continue;
            $value = trim(strip_tags((string) $value));
            if ($value === '') continue;
            $clean[$key] = self::text($value, $limit);
        }
        return $clean;
    }

    /**
     * Build the bounded reusable-template lookup used only during publication.
     * Sources are ordered by precedence; the canonical siteSettings catalog is
     * therefore passed before the legacy top-level catalog.
     *
     * @return array<string,array>
     */
    private static function template_library(mixed ...$sources): array {
        $library = [];
        foreach ($sources as $raw_library) {
            if (!is_array($raw_library)) continue;
            $entries = is_array($raw_library['templates'] ?? null)
                ? $raw_library['templates']
                : $raw_library;
            $source_library = [];
            $source_order = [];
            $candidate_count = 0;
            foreach ($entries as $key => $candidate) {
                if (++$candidate_count > self::MAX_LIBRARY_CANDIDATES) break;
                if (!is_array($candidate)
                    || (!isset($candidate['layers']) && !isset($candidate['elements']))) continue;
                $id = self::template_id((string) ($candidate['id'] ?? (is_string($key) ? $key : '')));
                // A higher-precedence source already owns this ID.
                if ($id === '' || isset($library[$id])) continue;
                if (!isset($source_library[$id])
                    && count($library) + count($source_library) >= self::MAX_LIBRARY_TEMPLATES) continue;
                // Associative catalogs may use the map key as the stable ID.
                // Inject it before sanitization so the projected template keeps
                // the same identity used by assignments and generated media.
                $candidate['id'] = $id;
                $template = self::sanitize_template($candidate);
                if (!$template) continue;
                if (!isset($source_library[$id])) $source_order[] = $id;
                // Match the editor's normalization: duplicate IDs inside one
                // catalog keep their position, but the latest definition wins.
                $source_library[$id] = $template;
            }
            foreach ($source_order as $id) $library[$id] = $source_library[$id];
            if (count($library) >= self::MAX_LIBRARY_TEMPLATES) break;
        }
        return $library;
    }

    /**
     * Add one normalized template to the compact public catalog and return its
     * assignment ID. Divergent legacy templates that reused an ID receive a
     * deterministic suffix instead of silently changing another assignment.
     */
    private static function register_contract_template(array &$templates, ?array $template): ?string {
        if (!$template) return null;
        $id = self::template_id((string) ($template['id'] ?? ''));
        if ($id === '') return null;
        $encoded = (string) json_encode($template, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (isset($templates[$id])) {
            $existing = (string) json_encode(
                $templates[$id],
                JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
            );
            if (hash_equals($existing, $encoded)) return $id;
            $id = substr($id, 0, 104) . '-' . substr(hash('sha256', $encoded), 0, 16);
            $template['id'] = $id;
            $encoded = (string) json_encode(
                $template,
                JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
            );
            if (isset($templates[$id])) {
                $existing = (string) json_encode(
                    $templates[$id],
                    JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
                );
                if (hash_equals($existing, $encoded)) return $id;
                return null;
            }
        }
        if (count($templates) >= self::MAX_LIBRARY_TEMPLATES) return null;
        $templates[$id] = $template;
        return $id;
    }

    /**
     * Normalize either a v2 catalog ID or an old v1 embedded full template into
     * a compact assignment. Missing catalog IDs are intentionally ignored.
     */
    private static function normalize_contract_assignment(mixed $candidate, array &$templates): ?string {
        if (is_scalar($candidate)) {
            $id = self::template_id((string) $candidate);
            return $id !== '' && isset($templates[$id]) ? $id : null;
        }
        $template = self::resolve_template_candidate($candidate, $templates);
        return self::register_contract_template($templates, $template);
    }

    /**
     * A valid catalog reference has precedence. If it was removed or corrupted,
     * retain an embedded legacy template when available. Returning null leaves a
     * page/CMS assignment absent, so template_for_post() naturally inherits the
     * post-type or site template.
     */
    private static function resolve_template_assignment(
        mixed $reference,
        mixed $legacy_candidate,
        array $library
    ): ?array {
        if (is_scalar($reference)) {
            $id = self::template_id((string) $reference);
            if ($id !== '' && isset($library[$id])) return $library[$id];
        }
        return self::resolve_template_candidate($legacy_candidate, $library);
    }

    private static function resolve_template_candidate(mixed $candidate, array $library): ?array {
        if (is_string($candidate)) $candidate = $library[self::template_id($candidate)] ?? null;
        if (is_array($candidate)
            && isset($candidate['templateId'])
            && !isset($candidate['layers'])
            && !isset($candidate['elements'])) {
            $candidate = $library[self::template_id((string) $candidate['templateId'])] ?? ($candidate['template'] ?? null);
        }
        if (is_array($candidate)
            && isset($candidate['template'])
            && !isset($candidate['layers'])
            && !isset($candidate['elements'])) {
            $candidate = $candidate['template'];
        }
        return self::sanitize_template($candidate);
    }

    private static function sanitize_template(mixed $candidate): ?array {
        if (!is_array($candidate) || ($candidate['enabled'] ?? true) === false) return null;
        $encoded = json_encode($candidate);
        if (!is_string($encoded) || strlen($encoded) > self::MAX_TEMPLATE_BYTES) return null;
        $width = self::integer($candidate['width'] ?? $candidate['canvas']['width'] ?? 1200, 1200, self::MIN_CANVAS_SIDE, self::MAX_CANVAS_SIDE);
        $height = self::integer($candidate['height'] ?? $candidate['canvas']['height'] ?? 630, 630, self::MIN_CANVAS_SIDE, self::MAX_CANVAS_SIDE);
        if ($width * $height > self::MAX_CANVAS_PIXELS) return null;
        $raw_layers = is_array($candidate['layers'] ?? null)
            ? $candidate['layers']
            : (is_array($candidate['elements'] ?? null) ? $candidate['elements'] : []);
        $layers = [];
        $remaining_layers = self::MAX_LAYERS;
        $remaining_pixels = self::MAX_TOTAL_LAYER_PIXELS;
        foreach (array_slice($raw_layers, 0, self::MAX_LAYERS) as $index => $layer) {
            if ($remaining_layers <= 0) break;
            $clean = self::sanitize_layer(
                $layer,
                $width,
                $height,
                0,
                $index,
                $remaining_layers,
                $remaining_pixels
            );
            if ($clean) $layers[] = $clean;
        }
        $valid_stack_layer_ids = [];
        foreach ($layers as $layer) {
            if (($layer['type'] ?? '') !== 'group' && ($layer['id'] ?? '') !== '') {
                $valid_stack_layer_ids[(string) $layer['id']] = true;
            }
        }
        $claimed_stack_layer_ids = [];
        $seen_stack_ids = [];
        $stacks = [];
        foreach (array_slice((array) ($candidate['stacks'] ?? []), 0, 50) as $stack_index => $raw_stack) {
            if (!is_array($raw_stack)) continue;
            $element_ids = [];
            foreach (array_slice((array) ($raw_stack['elementIds'] ?? []), 0, self::MAX_LAYERS) as $raw_id) {
                $element_id = self::key((string) $raw_id);
                if ($element_id === ''
                    || !isset($valid_stack_layer_ids[$element_id])
                    || isset($claimed_stack_layer_ids[$element_id])
                    || in_array($element_id, $element_ids, true)) continue;
                $element_ids[] = $element_id;
            }
            if (count($element_ids) < 2) continue;
            $preferred_id = self::key((string) ($raw_stack['id'] ?? ''));
            $stack_id = $preferred_id !== '' ? $preferred_id : 'stack-' . ($stack_index + 1);
            $suffix = 2;
            while (isset($seen_stack_ids[$stack_id])) {
                $stack_id = ($preferred_id !== '' ? $preferred_id : 'stack-' . ($stack_index + 1)) . '-' . $suffix;
                $suffix++;
            }
            $seen_stack_ids[$stack_id] = true;
            foreach ($element_ids as $element_id) $claimed_stack_layer_ids[$element_id] = true;
            $direction = strtolower((string) ($raw_stack['direction'] ?? 'vertical'));
            $align = strtolower((string) ($raw_stack['align'] ?? 'start'));
            $anchor = strtolower((string) ($raw_stack['anchor'] ?? 'center'));
            $stacks[] = [
                'id' => $stack_id,
                'elementIds' => $element_ids,
                'direction' => $direction === 'horizontal' ? 'horizontal' : 'vertical',
                'gap' => self::number($raw_stack['gap'] ?? 24, 24, 0, self::MAX_CANVAS_SIDE),
                'align' => in_array($align, ['start', 'center', 'end'], true) ? $align : 'start',
                'anchor' => in_array($anchor, ['start', 'center', 'end'], true) ? $anchor : 'center',
            ];
        }
        $raw_background = $candidate['background'] ?? $candidate['canvas']['background'] ?? '#ffffff';
        $background_image = self::path_value((string) (
            $candidate['backgroundImage']
            ?? (is_array($raw_background) ? ($raw_background['image'] ?? '') : '')
        ));
        $background_is_dynamic = str_contains($background_image, '{{');
        $background_attachment_id = $background_is_dynamic
            ? 0
            : abs((int) (
                $candidate['backgroundAttachmentId']
                ?? $candidate['backgroundImageAttachmentId']
                ?? (is_array($raw_background) ? ($raw_background['imageAttachmentId'] ?? 0) : 0)
            ));
        $template = [
            'id' => self::template_id((string) ($candidate['id'] ?? '')),
            'name' => self::text((string) ($candidate['name'] ?? 'Social Image'), 120),
            'width' => $width,
            'height' => $height,
            'background' => self::sanitize_paint($raw_background),
            'backgroundImage' => $background_image,
            'backgroundAttachmentId' => $background_attachment_id,
            'backgroundImageFit' => in_array(($fit = strtolower((string) (
                $candidate['backgroundImageFit']
                ?? (is_array($raw_background) ? ($raw_background['imageFit'] ?? 'cover') : 'cover')
            ))), ['cover', 'contain', 'fill'], true)
                    ? $fit
                    : 'cover',
            'backgroundImageOpacity' => self::opacity(
                $candidate['backgroundImageOpacity']
                ?? (is_array($raw_background) ? ($raw_background['imageOpacity'] ?? 1) : 1)
            ),
            'layers' => $layers,
            'stacks' => $stacks,
        ];
        if ($template['id'] === '') {
            $template['id'] = 'social-' . substr(hash('sha256', (string) json_encode($template)), 0, 20);
        }
        return $template;
    }

    private static function sanitize_layer(
        mixed $candidate,
        int $canvas_width,
        int $canvas_height,
        int $depth,
        int $index,
        int &$remaining_layers,
        int &$remaining_pixels
    ): ?array {
        if (!is_array($candidate) || $depth > self::MAX_LAYER_DEPTH || $remaining_layers <= 0) return null;
        $remaining_layers--;
        $type = strtolower(trim((string) ($candidate['type'] ?? 'shape')));
        if (in_array($type, ['rectangle', 'ellipse', 'circle'], true)) {
            $candidate['shape'] = $type === 'circle' ? 'ellipse' : $type;
            $type = 'shape';
        }
        if (!in_array($type, ['text', 'image', 'shape', 'icon', 'group'], true)) return null;
        $frame = is_array($candidate['frame'] ?? null) ? $candidate['frame'] : [];
        $style = is_array($candidate['style'] ?? null) ? $candidate['style'] : [];
        $x = self::number($candidate['x'] ?? $frame['x'] ?? 0, 0, -self::MAX_CANVAS_SIDE, self::MAX_CANVAS_SIDE);
        $y = self::number($candidate['y'] ?? $frame['y'] ?? 0, 0, -self::MAX_CANVAS_SIDE, self::MAX_CANVAS_SIDE);
        $width_unit = strtolower(trim((string) ($candidate['widthUnit'] ?? $frame['widthUnit'] ?? 'px')));
        $width_unit = in_array($width_unit, ['percent', '%'], true) ? 'percent' : 'px';
        $horizontal_anchor = strtolower(trim((string) (
            $candidate['horizontalAnchor']
            ?? $frame['horizontalAnchor']
            ?? 'left'
        )));
        if ($horizontal_anchor === 'middle') $horizontal_anchor = 'center';
        if (!in_array($horizontal_anchor, ['left', 'center', 'right'], true)) $horizontal_anchor = 'left';
        $vertical_anchor = strtolower(trim((string) (
            $candidate['verticalAnchor']
            ?? $frame['verticalAnchor']
            ?? 'top'
        )));
        if ($vertical_anchor === 'middle') $vertical_anchor = 'center';
        if (!in_array($vertical_anchor, ['top', 'center', 'bottom'], true)) $vertical_anchor = 'top';
        $auto_height = $type === 'text' && ($candidate['autoHeight'] ?? false) === true;
        $default_width = $type === 'text' ? max(1, $canvas_width - (int) max(0, $x)) : 100;
        $default_height = $type === 'text' ? 160 : 100;
        $raw_width = $candidate['width'] ?? $frame['width'] ?? null;
        if ($width_unit === 'percent') {
            $default_percent = max(1, min(100, ($default_width / max(1, $canvas_width)) * 100));
            $width = self::number($raw_width ?? $default_percent, $default_percent, 1, 100);
            $resolved_width = max(1, min(
                self::MAX_CANVAS_SIDE,
                (int) round($canvas_width * $width / 100)
            ));
        } else {
            $width = self::integer($raw_width ?? $default_width, $default_width, 1, self::MAX_CANVAS_SIDE);
            $resolved_width = (int) $width;
        }
        $height = self::integer($candidate['height'] ?? $frame['height'] ?? $default_height, $default_height, 1, self::MAX_CANVAS_SIDE);
        // Auto-height is data-dependent. Reserve its full anchored growth area
        // during sanitization so dynamic content cannot bypass either pixel
        // budget at render time.
        $budget_height = $auto_height
            ? self::auto_height_limit($canvas_height, $y, $vertical_anchor)
            : $height;
        $pixels = $resolved_width * $budget_height;
        if ($pixels > self::MAX_LAYER_PIXELS || ($type !== 'group' && $pixels > $remaining_pixels)) return null;
        if ($type !== 'group') $remaining_pixels -= $pixels;
        $layer = [
            'id' => self::key((string) ($candidate['id'] ?? 'layer-' . $index)),
            'name' => self::text((string) ($candidate['name'] ?? ucfirst($type)), 120),
            'type' => $type,
            'visible' => ($candidate['visible'] ?? true) !== false,
            'x' => $x,
            'y' => $y,
            'width' => $width,
            'widthUnit' => $width_unit,
            'height' => $height,
            'horizontalAnchor' => $horizontal_anchor,
            'verticalAnchor' => $vertical_anchor,
            'rotation' => self::number($candidate['rotation'] ?? 0, 0, -360, 360),
            'opacity' => self::opacity($candidate['opacity'] ?? 1),
            'fill' => self::sanitize_paint($candidate['fill'] ?? $style['fill'] ?? $candidate['color'] ?? '#111111'),
            'border' => self::sanitize_border($candidate['border'] ?? $style['border'] ?? []),
            'shadow' => self::sanitize_shadow($candidate['shadow'] ?? $style['shadow'] ?? []),
            'radius' => self::number(
                $candidate['radius']
                    ?? $candidate['borderRadius']
                    ?? $candidate['border']['radius']
                    ?? $style['borderRadius']
                    ?? 0,
                0,
                0,
                min($resolved_width, $height) / 2
            ),
        ];
        if ($layer['id'] === '') $layer['id'] = 'layer-' . $index;

        if ($type === 'text') {
            $layer['text'] = self::text((string) ($candidate['text'] ?? $candidate['content'] ?? $candidate['value'] ?? ''), self::MAX_TEXT_BYTES);
            $layer['variable'] = self::token((string) ($candidate['variable'] ?? $candidate['binding'] ?? ''));
            // A project font is portable only when the template also carries
            // its local TTF/OTF path. Arbitrary legacy family names without a
            // file continue to canonicalize to the bundled Geist face so
            // rendering never depends on fonts installed on the host.
            $font_file = self::local_font_path(
                (string) ($candidate['fontFile'] ?? $style['fontFile'] ?? '')
            );
            $font_weight = self::social_font_weight(
                $candidate['fontWeight'] ?? $style['fontWeight'] ?? 600
            );
            $layer['fontFamily'] = $font_file !== ''
                ? self::font_family($candidate['fontFamily'] ?? $style['fontFamily'] ?? 'Geist')
                : 'Geist';
            $layer['fontFile'] = $font_file;
            $layer['fontSize'] = self::number($candidate['fontSize'] ?? $style['fontSize'] ?? ($type === 'icon' ? 64 : 48), 48, 6, 512);
            $layer['fontWeight'] = $font_weight;
            if ($font_file !== '') {
                $authored_file_weight = $candidate['fontFileWeight']
                    ?? $style['fontFileWeight']
                    ?? null;
                $inferred_file_weight = self::infer_font_file_weight($font_file);
                $layer['fontFileWeight'] = self::social_font_weight(
                    $authored_file_weight !== null && $authored_file_weight !== ''
                        ? $authored_file_weight
                        : ($inferred_file_weight ?? 400),
                    400
                );
            }
            $layer['italic'] = false;
            $layer['lineHeight'] = self::number($candidate['lineHeight'] ?? $style['lineHeight'] ?? 1.2, 1.2, 0.5, 1024);
            $layer['letterSpacing'] = self::number($candidate['letterSpacing'] ?? $style['letterSpacing'] ?? 0, 0, -20, 100);
            $align = strtolower((string) ($candidate['textAlign'] ?? $candidate['align'] ?? $style['textAlign'] ?? 'left'));
            $layer['textAlign'] = in_array($align, ['left', 'center', 'right'], true) ? $align : 'left';
            $vertical = strtolower((string) ($candidate['verticalAlign'] ?? $style['verticalAlign'] ?? 'top'));
            if ($vertical === 'middle') $vertical = 'center';
            $layer['verticalAlign'] = in_array($vertical, ['top', 'center', 'bottom'], true) ? $vertical : 'top';
            $layer['autoHeight'] = $auto_height;
        }
        if ($type === 'image') {
            $source = $candidate['src'] ?? $candidate['source'] ?? $candidate['image'] ?? $candidate['value'] ?? '';
            $layer['src'] = is_scalar($source) ? self::path_value((string) $source) : '';
            $layer['variable'] = self::token((string) ($candidate['variable'] ?? $candidate['binding'] ?? ''));
            $dynamic_source = $layer['variable'] !== '' || str_contains($layer['src'], '{{');
            $layer['attachmentId'] = $dynamic_source
                ? 0
                : abs((int) ($candidate['attachmentId'] ?? (is_numeric($source) ? $source : 0)));
            $fit = strtolower((string) ($candidate['fit'] ?? $candidate['objectFit'] ?? 'cover'));
            $layer['fit'] = in_array($fit, ['cover', 'contain', 'fill'], true) ? $fit : 'cover';
            $layer['focalX'] = self::number($candidate['focalX'] ?? $candidate['objectPositionX'] ?? 50, 50, 0, 100);
            $layer['focalY'] = self::number($candidate['focalY'] ?? $candidate['objectPositionY'] ?? 50, 50, 0, 100);
        }
        if ($type === 'shape') {
            $shape = strtolower((string) ($candidate['shape'] ?? 'rectangle'));
            $layer['shape'] = in_array($shape, ['rectangle', 'ellipse', 'line'], true) ? $shape : 'rectangle';
        }
        if ($type === 'icon') {
            $icon = strtolower((string) ($candidate['icon'] ?? 'sparkles'));
            $layer['icon'] = in_array($icon, ['sparkles', 'star', 'heart', 'arrow-up-right', 'check', 'play'], true)
                ? $icon
                : 'sparkles';
            $layer['strokeWidth'] = self::number($candidate['strokeWidth'] ?? 2, 2, 1, 16);
        }
        if ($type === 'group') {
            $children = [];
            foreach (array_slice((array) ($candidate['children'] ?? []), 0, self::MAX_LAYERS) as $child_index => $child) {
                if ($remaining_layers <= 0) break;
                $clean = self::sanitize_layer(
                    $child,
                    $resolved_width,
                    $height,
                    $depth + 1,
                    $child_index,
                    $remaining_layers,
                    $remaining_pixels
                );
                if ($clean) $children[] = $clean;
            }
            $layer['children'] = $children;
        }
        return $layer;
    }

    private static function sanitize_paint(mixed $candidate): array {
        if (is_string($candidate)) return ['type' => 'solid', 'color' => self::color($candidate)];
        if (!is_array($candidate)) return ['type' => 'solid', 'color' => '#ffffff'];
        $nested_gradient = is_array($candidate['gradient'] ?? null) ? $candidate['gradient'] : null;
        if (is_array($nested_gradient) && ($nested_gradient['enabled'] ?? false) === true) {
            return [
                'type' => 'linear-gradient',
                'angle' => self::number($nested_gradient['angle'] ?? 135, 135, -360, 360),
                'stops' => [
                    ['offset' => 0, 'color' => self::color((string) ($nested_gradient['from'] ?? '#ffffff'))],
                    ['offset' => 1, 'color' => self::color((string) ($nested_gradient['to'] ?? '#000000'))],
                ],
            ];
        }
        $type = strtolower((string) ($candidate['type'] ?? 'solid'));
        if (in_array($type, ['linear', 'linear-gradient', 'gradient'], true)) {
            $stops = [];
            $raw_stops = is_array($candidate['stops'] ?? null)
                ? $candidate['stops']
                : (is_array($candidate['colors'] ?? null) ? $candidate['colors'] : []);
            $count = max(1, count($raw_stops) - 1);
            foreach (array_slice($raw_stops, 0, 8) as $index => $stop) {
                if (is_string($stop)) {
                    $stops[] = ['offset' => $index / $count, 'color' => self::color($stop)];
                } elseif (is_array($stop)) {
                    $offset = $stop['offset'] ?? $stop['position'] ?? ($index / $count);
                    if ((float) $offset > 1) $offset = (float) $offset / 100;
                    $stops[] = [
                        'offset' => self::number($offset, $index / $count, 0, 1),
                        'color' => self::color((string) ($stop['color'] ?? '#ffffff')),
                    ];
                }
            }
            if (count($stops) < 2) {
                $stops = [
                    ['offset' => 0, 'color' => self::color((string) ($candidate['from'] ?? '#ffffff'))],
                    ['offset' => 1, 'color' => self::color((string) ($candidate['to'] ?? '#000000'))],
                ];
            }
            usort($stops, static fn(array $left, array $right): int => $left['offset'] <=> $right['offset']);
            return [
                'type' => 'linear-gradient',
                'angle' => self::number($candidate['angle'] ?? 180, 180, -360, 360),
                'stops' => $stops,
            ];
        }
        return ['type' => 'solid', 'color' => self::color((string) ($candidate['color'] ?? $candidate['value'] ?? '#ffffff'))];
    }

    private static function sanitize_border(mixed $candidate): array {
        if (is_string($candidate)) return ['width' => 1, 'color' => self::color($candidate)];
        if (!is_array($candidate)) return ['width' => 0, 'color' => '#00000000'];
        return [
            'width' => self::integer($candidate['width'] ?? 0, 0, 0, 128),
            'color' => self::color((string) ($candidate['color'] ?? '#000000')),
        ];
    }

    private static function sanitize_shadow(mixed $candidate): array {
        if (!is_array($candidate) || !$candidate) return ['enabled' => false, 'color' => '#00000000', 'opacity' => 0, 'blur' => 0, 'offsetX' => 0, 'offsetY' => 0];
        $has_visual_settings = array_intersect(
            ['color', 'opacity', 'blur', 'offsetX', 'offsetY', 'x', 'y'],
            array_keys($candidate)
        ) !== [];
        return [
            'enabled' => array_key_exists('enabled', $candidate)
                ? $candidate['enabled'] === true
                : $has_visual_settings,
            'color' => self::color((string) ($candidate['color'] ?? '#00000055')),
            'opacity' => self::opacity($candidate['opacity'] ?? 1),
            'blur' => self::integer($candidate['blur'] ?? 0, 0, 0, 64),
            'offsetX' => self::number($candidate['offsetX'] ?? $candidate['x'] ?? 0, 0, -256, 256),
            'offsetY' => self::number($candidate['offsetY'] ?? $candidate['y'] ?? 4, 4, -256, 256),
        ];
    }

    private static function key(string $value): string {
        return substr(preg_replace('/[^a-z0-9_-]+/', '-', strtolower(trim($value))) ?: '', 0, 128);
    }

    private static function template_id(string $value): string {
        $id = self::key($value);
        return in_array($id, ['__none__', '__inherit__'], true) ? '' : $id;
    }

    private static function path(string $value): string {
        $value = ltrim(str_replace('\\', '/', trim($value)), '/');
        if ($value === '' || strlen($value) > 512 || str_contains($value, '../') || str_contains($value, "\0")) return '';
        return $value;
    }

    private static function path_value(string $value): string {
        $value = trim($value);
        if (strlen($value) > 2048 || str_contains($value, "\0")) return '';
        return $value;
    }

    private static function token(string $value): string {
        $value = trim($value);
        return strlen($value) <= 128 && preg_match('/^[A-Za-z0-9_.:-]+$/D', $value) ? $value : '';
    }

    private static function font_family(mixed $value): string {
        $family = trim((string) $value, " \t\n\r\0\x0B\"'");
        $family = preg_replace('/[\x00-\x1F\x7F]/u', '', $family) ?: '';
        return $family !== '' ? self::text($family, 160) : 'Geist';
    }

    private static function local_font_path(string $value): string {
        $value = ltrim(str_replace('\\', '/', trim($value)), '/');
        $decoded = str_replace('\\', '/', rawurldecode($value));
        if ($value === ''
            || strlen($value) > 1024
            || str_contains($decoded, "\0")
            || preg_match('~(?:^|/)\.\.(?:/|$)~', $decoded)
            || preg_match('~(?:^|/)\.incode(?:/|$)~i', $decoded)
            || preg_match('~^(?:[a-z][a-z0-9+.-]*:|//)~i', $decoded)) {
            return '';
        }
        $extension = strtolower(pathinfo($value, PATHINFO_EXTENSION));
        return in_array($extension, ['ttf', 'otf'], true) ? $value : '';
    }

    private static function text(string $value, int $limit): string {
        if (strlen($value) <= $limit) return $value;
        return substr($value, 0, $limit);
    }

    private static function integer(mixed $value, int $default, int $minimum, int $maximum): int {
        if (!is_numeric($value)) return $default;
        return max($minimum, min($maximum, (int) round((float) $value)));
    }

    private static function social_font_weight(mixed $value, int $default = 600): int {
        $keyword = strtolower(preg_replace('/[\s_-]+/', '', trim((string) $value)) ?: '');
        $keywords = [
            'thin' => 100,
            'hairline' => 100,
            'extralight' => 200,
            'ultralight' => 200,
            'light' => 300,
            'normal' => 400,
            'regular' => 400,
            'book' => 400,
            'roman' => 400,
            'medium' => 500,
            'semibold' => 600,
            'demibold' => 600,
            'bold' => 700,
            'extrabold' => 800,
            'ultrabold' => 800,
            'black' => 900,
            'heavy' => 900,
        ];
        $weight = $keywords[$keyword] ?? (is_numeric($value) ? (float) $value : $default);
        return (int) (round(max(100, min(900, $weight)) / 100) * 100);
    }

    private static function infer_font_file_weight(string $value): ?int {
        $file = strtolower(pathinfo(rawurldecode(str_replace('\\', '/', $value)), PATHINFO_FILENAME));
        if (preg_match('/(?:^|[^0-9])([1-9]00)(?=[^0-9]|$)/', $file, $match)) {
            return self::social_font_weight($match[1], 400);
        }
        $compact = preg_replace('/[\s_-]+/', '', $file) ?: '';
        $patterns = [
            '/(?:thin|hairline)/' => 100,
            '/(?:extralight|ultralight)/' => 200,
            '/light/' => 300,
            '/(?:book|regular|normal|roman)/' => 400,
            '/medium/' => 500,
            '/(?:semibold|demibold)/' => 600,
            '/(?:extrabold|ultrabold)/' => 800,
            '/(?:black|heavy)/' => 900,
            '/bold/' => 700,
        ];
        foreach ($patterns as $pattern => $weight) {
            if (preg_match($pattern, $compact)) return $weight;
        }
        return null;
    }

    private static function synthetic_font_stroke(array $layer): int {
        $requested = self::social_font_weight($layer['fontWeight'] ?? 600);
        $font_file = self::local_font_path((string) ($layer['fontFile'] ?? ''));
        $actual = $font_file !== ''
            ? self::social_font_weight(
                $layer['fontFileWeight'] ?? self::infer_font_file_weight($font_file) ?? 400,
                400
            )
            : 400;
        $difference = $requested - $actual;
        if ($difference <= 0) return 0;
        return $difference >= 400 ? 2 : 1;
    }

    private static function number(mixed $value, float $default, float $minimum, float $maximum): float {
        if (!is_numeric($value) || !is_finite((float) $value)) return $default;
        return max($minimum, min($maximum, (float) $value));
    }

    private static function opacity(mixed $value): float {
        $value = is_numeric($value) ? (float) $value : 1;
        if ($value > 1) $value /= 100;
        return max(0, min(1, $value));
    }

    /**
     * Maximum fit-content height that keeps the selected anchor line fixed.
     * Negative top/bottom offsets intentionally allow a surface to begin outside
     * the parent and be clipped at its opposite edge, matching the canvas preview.
     */
    private static function auto_height_limit(
        int $container_height,
        float $offset,
        string $vertical_anchor
    ): int {
        if ($vertical_anchor === 'center') {
            $anchor_line = ($container_height / 2) + $offset;
            $available = 2 * min($anchor_line, $container_height - $anchor_line);
        } else {
            $available = $container_height - $offset;
        }
        return max(1, min(self::MAX_CANVAS_SIDE, (int) floor($available)));
    }

    private static function color(string $value): string {
        $value = trim($value);
        if (preg_match('/^#[0-9a-f]{3,4}$/i', $value)) {
            $digits = substr($value, 1);
            $expanded = '';
            foreach (str_split($digits) as $digit) $expanded .= $digit . $digit;
            return '#' . strtolower($expanded);
        }
        if (preg_match('/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i', $value)) return strtolower($value);
        if (preg_match('/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i', $value, $match)) {
            $red = max(0, min(255, (int) $match[1]));
            $green = max(0, min(255, (int) $match[2]));
            $blue = max(0, min(255, (int) $match[3]));
            $alpha = isset($match[4]) ? max(0, min(1, (float) $match[4])) : 1;
            return sprintf('#%02x%02x%02x%02x', $red, $green, $blue, (int) round($alpha * 255));
        }
        return '#000000';
    }

    private function primary_term(WP_Post $post): ?WP_Term {
        $taxonomies = ['category', 'product_cat'];
        if (function_exists('get_object_taxonomies')) {
            foreach ((array) get_object_taxonomies($post->post_type, 'objects') as $taxonomy) {
                if ($taxonomy instanceof WP_Taxonomy && $taxonomy->public && $taxonomy->hierarchical) $taxonomies[] = $taxonomy->name;
            }
        }
        foreach (array_values(array_unique($taxonomies)) as $taxonomy) {
            $terms = get_the_terms($post, $taxonomy);
            if (is_array($terms) && isset($terms[0]) && $terms[0] instanceof WP_Term) return $terms[0];
        }
        return null;
    }

    private function should_queue_post(int $post_id, WP_Post $post): bool {
        if (!Kodety_Edition::has('socialImageBuilder')) return false;
        if ($post_id <= 0 || $post->post_type === 'attachment' || $post->post_status !== 'publish') return false;
        if (function_exists('wp_is_post_revision') && wp_is_post_revision($post_id)) return false;
        if (function_exists('wp_is_post_autosave') && wp_is_post_autosave($post_id)) return false;
        if (function_exists('get_post_type_object')) {
            $type = get_post_type_object($post->post_type);
            if (!$type || (empty($type->public) && empty($type->publicly_queryable))) return false;
        }
        return $this->template_for_post($post) !== null;
    }

    private function assigned_project_path(WP_Post $post): string {
        if ($post->post_type === 'page') {
            $path = self::path((string) get_post_meta($post->ID, '_kodety_html_path', true));
            if ($path !== '') return $path;
        }
        $cms_templates = class_exists('Kodety_Plugin')
            ? Kodety_Plugin::instance()->project_cms_option('kodety_cms_templates', [])
            : get_option('kodety_cms_templates', []);
        return is_array($cms_templates)
            ? self::path((string) ($cms_templates[$post->post_type] ?? ''))
            : '';
    }

    private function project_page_variables(WP_Post $post): array {
        $path = $this->assigned_project_path($post);
        if ($path === '') return [];
        $variables = $this->published_contract()['pageVariables'][$path] ?? [];
        return is_array($variables) ? $variables : [];
    }

    /**
     * Resolve SEO text projected from the Onun Kodety workspace. CMS bindings use the
     * final native/meta state, while page.* self-references deliberately use
     * native values to avoid recursion.
     */
    private function resolve_project_variable(string $template, WP_Post $post, string $fallback): string {
        if ($template === '') return $fallback;
        if (!str_contains($template, '{{')) return $template;
        $resolved = preg_replace_callback('/\{\{([^{}]+)\}\}/', function (array $match) use ($post): string {
            $token = trim((string) $match[1]);
            if ($token === '' || strlen($token) > 128 || !preg_match('/^[A-Za-z0-9_.:-]+$/D', $token)) return '';
            $thumbnail_id = get_post_thumbnail_id($post);
            $native = match ($token) {
                'title', 'page.title' => get_the_title($post),
                'excerpt', 'description', 'page.excerpt' => get_the_excerpt($post),
                'content', 'page.content' => wp_strip_all_tags((string) $post->post_content),
                'featured_image', 'page.featured_image' => $thumbnail_id
                    ? (string) (wp_get_attachment_image_url($thumbnail_id, 'full') ?: '')
                    : '',
                'featured_image_alt', 'page.featured_image_alt' => $thumbnail_id
                    ? (string) get_post_meta($thumbnail_id, '_wp_attachment_image_alt', true)
                    : '',
                'permalink', 'url', 'page.permalink', 'page.url' => (string) get_permalink($post),
                'date', 'page.date' => get_the_date('', $post),
                'slug', 'page.slug' => $post->post_name,
                default => null,
            };
            if ($native !== null) return (string) $native;

            if (!str_contains($token, '.') && !str_contains($token, ':')) {
                $key = self::key($token);
                if ($key === '' || str_starts_with($key, '_')) return '';
                $value = function_exists('get_field')
                    ? get_field($key, $post->ID)
                    : get_post_meta($post->ID, $key, true);
                return $this->scalar_value($value);
            }
            return $this->scalar_value($this->resolve_variable_for_post($token, $post));
        }, $template);
        return is_string($resolved) && trim($resolved) !== '' ? $resolved : $fallback;
    }

    private function template_for_post(WP_Post $post): ?array {
        $contract = $this->published_contract();
        $path = $this->assigned_project_path($post);
        $template_id = $path !== '' ? ($contract['pageTemplates'][$path] ?? null) : null;
        if (!is_string($template_id) || $template_id === '') {
            $template_id = $contract['postTypeTemplates'][$post->post_type] ?? null;
        }
        if (!is_string($template_id) || $template_id === '') {
            $template_id = $contract['siteTemplate'] ?? null;
        }
        if (!is_string($template_id) || $template_id === '') return null;
        $template = $contract['templates'][$template_id] ?? null;
        return is_array($template) ? $template : null;
    }

    private function render_hash(array $template, WP_Post $post): string {
        $encoded = (string) json_encode($template, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        preg_match_all('/\{\{([^{}]+)\}\}/', $encoded, $matches);
        $tokens = array_values(array_unique(array_filter(array_map('trim', $matches[1] ?? []))));
        $this->collect_explicit_variables($template['layers'], $tokens);
        sort($tokens, SORT_STRING);
        $values = [];
        foreach ($tokens as $token) $values[$token] = $this->scalar_value($this->resolve_variable_for_post($token, $post));
        $assets = [];
        $background_source = $this->background_image_source($template, $post);
        $background_is_dynamic = str_contains((string) ($template['backgroundImage'] ?? ''), '{{');
        $background_attachment_id = $background_is_dynamic
            ? 0
            : (int) ($template['backgroundAttachmentId'] ?? 0);
        $this->collect_asset_signature($background_source, $background_attachment_id, $assets);
        foreach ($template['layers'] as $layer) $this->collect_asset_signatures($layer, $post, $assets);
        return hash('sha256', (string) json_encode([
            'renderer' => 5,
            'template' => $template,
            'values' => $values,
            'assets' => $assets,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    private function collect_explicit_variables(array $layers, array &$tokens): void {
        foreach ($layers as $layer) {
            if (!empty($layer['variable'])) $tokens[] = $layer['variable'];
            if (!empty($layer['children'])) $this->collect_explicit_variables($layer['children'], $tokens);
        }
        $tokens = array_values(array_unique($tokens));
    }

    private function collect_asset_signatures(array $layer, WP_Post $post, array &$assets): void {
        if (($layer['type'] ?? '') === 'image') {
            $source = $this->image_layer_source($layer, $post);
            $dynamic_source = !empty($layer['variable']) || str_contains((string) ($layer['src'] ?? ''), '{{');
            $attachment_id = $dynamic_source ? 0 : (int) ($layer['attachmentId'] ?? 0);
            $this->collect_asset_signature($source, $attachment_id, $assets);
        }
        if (($layer['type'] ?? '') === 'text') {
            $font = $this->font_path($layer);
            if ($font !== '' && is_file($font)) {
                $assets[] = [$font, (int) filesize($font), (int) filemtime($font)];
            }
        }
        foreach ((array) ($layer['children'] ?? []) as $child) $this->collect_asset_signatures($child, $post, $assets);
    }

    private function collect_asset_signature(mixed $source, int $attachment_id, array &$assets): void {
        $path = $this->local_image_path($source, $attachment_id);
        if (is_string($path) && is_file($path)) {
            $assets[] = [$path, (int) filesize($path), (int) filemtime($path)];
        }
    }

    private function render_template(array $template, WP_Post $post): mixed {
        $width = (int) $template['width'];
        $height = (int) $template['height'];
        $canvas = $this->transparent_image($width, $height);
        if (!$canvas) return new WP_Error('kodety_social_canvas', 'Não foi possível criar o canvas GD.');
        $this->draw_paint($canvas, $template['background'], $width, $height);
        $background_source = $this->background_image_source($template, $post);
        $background_is_dynamic = str_contains((string) ($template['backgroundImage'] ?? ''), '{{');
        $background_attachment_id = $background_is_dynamic
            ? 0
            : (int) ($template['backgroundAttachmentId'] ?? 0);
        $background_path = $this->local_image_path($background_source, $background_attachment_id);
        if ($background_path !== null) {
            $background_image = $this->load_image($background_path);
            if (is_wp_error($background_image)) {
                imagedestroy($canvas);
                return $background_image;
            }
            $background_surface = $this->transparent_image($width, $height);
            if (!$background_surface) {
                imagedestroy($background_image);
                imagedestroy($canvas);
                return new WP_Error('kodety_social_background', 'Não foi possível criar o background GD.');
            }
            $this->draw_fitted_image($background_surface, $background_image, [
                'fit' => (string) ($template['backgroundImageFit'] ?? 'cover'),
                'focalX' => 50,
                'focalY' => 50,
            ]);
            imagedestroy($background_image);
            $this->composite(
                $canvas,
                $background_surface,
                0,
                0,
                (float) ($template['backgroundImageOpacity'] ?? 1),
                0
            );
            imagedestroy($background_surface);
        }
        $result = $this->render_layers(
            $canvas,
            $template['layers'],
            $post,
            0,
            0,
            1,
            0,
            $width,
            $height,
            (array) ($template['stacks'] ?? [])
        );
        if (is_wp_error($result)) {
            imagedestroy($canvas);
            return $result;
        }
        return $canvas;
    }

    private function render_layers(
        mixed $canvas,
        array $layers,
        WP_Post $post,
        float $offset_x,
        float $offset_y,
        float $inherited_opacity,
        int $depth,
        int $container_width,
        int $container_height,
        array $stacks = []
    ): bool|WP_Error {
        if ($depth > self::MAX_LAYER_DEPTH) return true;
        $stack_placements = $depth === 0 && $stacks
            ? $this->stack_layer_placements(
                $layers,
                $stacks,
                $post,
                $container_width,
                $container_height
            )
            : [];
        if (is_wp_error($stack_placements)) return $stack_placements;
        foreach ($layers as $layer) {
            if (empty($layer['visible']) || $layer['opacity'] <= 0) continue;
            $opacity = max(0, min(1, $inherited_opacity * (float) $layer['opacity']));
            $resolved_width = self::layer_width_pixels($layer, $container_width);
            if ($layer['type'] === 'group') {
                [$x, $y] = self::anchored_layer_position(
                    $layer,
                    $container_width,
                    $container_height,
                    $resolved_width,
                    (int) $layer['height'],
                    $offset_x,
                    $offset_y
                );
                $result = $this->render_layers(
                    $canvas,
                    $layer['children'],
                    $post,
                    $x,
                    $y,
                    $opacity,
                    $depth + 1,
                    $resolved_width,
                    (int) $layer['height'],
                    []
                );
                if (is_wp_error($result)) return $result;
                continue;
            }
            $surface = $this->render_layer_surface(
                $layer,
                $post,
                $resolved_width,
                $container_height,
                isset($stack_placements[$layer['id']]['height'])
                    ? (int) $stack_placements[$layer['id']]['height']
                    : null
            );
            if (is_wp_error($surface)) return $surface;
            if (!$surface) continue;
            if (isset($stack_placements[$layer['id']])) {
                $x = (int) $stack_placements[$layer['id']]['x'];
                $y = (int) $stack_placements[$layer['id']]['y'];
            } else {
                [$x, $y] = self::anchored_layer_position(
                    $layer,
                    $container_width,
                    $container_height,
                    imagesx($surface),
                    imagesy($surface),
                    $offset_x,
                    $offset_y
                );
            }
            if (!empty($layer['shadow']['enabled'])) {
                $shadow = $this->shadow_surface($surface, $layer['shadow']);
                if (is_wp_error($shadow)) {
                    imagedestroy($surface);
                    return $shadow;
                }
                if ($shadow) {
                    $shadow_padding_x = (int) floor((imagesx($shadow) - imagesx($surface)) / 2);
                    $shadow_padding_y = (int) floor((imagesy($shadow) - imagesy($surface)) / 2);
                    $this->composite(
                        $canvas,
                        $shadow,
                        $x + (int) round($layer['shadow']['offsetX']) - $shadow_padding_x,
                        $y + (int) round($layer['shadow']['offsetY']) - $shadow_padding_y,
                        $opacity,
                        (float) $layer['rotation']
                    );
                    imagedestroy($shadow);
                }
            }
            $this->composite($canvas, $surface, $x, $y, $opacity, (float) $layer['rotation']);
            imagedestroy($surface);
        }
        return true;
    }

    /**
     * Resolve persistent Stack constraints against the final post text before
     * drawing. The stored layer rectangles define the Stack anchor frame while
     * fit-content text heights drive the live reflow.
     *
     * @return array<string,array{x:int,y:int,width:int,height:int}>|WP_Error
     */
    private function stack_layer_placements(
        array $layers,
        array $stacks,
        WP_Post $post,
        int $container_width,
        int $container_height
    ): array|WP_Error {
        $layers_by_id = [];
        foreach ($layers as $layer) {
            if (empty($layer['visible']) || ($layer['type'] ?? '') === 'group') continue;
            $layer_id = (string) ($layer['id'] ?? '');
            if ($layer_id !== '') $layers_by_id[$layer_id] = $layer;
        }
        $placements = [];
        $claimed = [];
        foreach ($stacks as $stack) {
            $members = [];
            foreach ((array) ($stack['elementIds'] ?? []) as $element_id) {
                $element_id = (string) $element_id;
                if (isset($claimed[$element_id]) || !isset($layers_by_id[$element_id])) continue;
                $layer = $layers_by_id[$element_id];
                $width = self::layer_width_pixels($layer, $container_width);
                $stored_height = max(1, (int) ($layer['height'] ?? 1));
                [$baseline_x, $baseline_y] = self::anchored_layer_position(
                    $layer,
                    $container_width,
                    $container_height,
                    $width,
                    $stored_height
                );
                $actual_height = $stored_height;
                if (($layer['type'] ?? '') === 'text' && !empty($layer['autoHeight'])) {
                    $actual_height = $this->fit_text_height(
                        $this->text_layer_value($layer, $post),
                        $layer,
                        $width,
                        min(self::MAX_CANVAS_SIDE, max(1, $container_height))
                    );
                    if (is_wp_error($actual_height)) return $actual_height;
                }
                $members[] = [
                    'id' => $element_id,
                    'baselineX' => $baseline_x,
                    'baselineY' => $baseline_y,
                    'baselineWidth' => $width,
                    'baselineHeight' => $stored_height,
                    'width' => $width,
                    'height' => max(1, (int) $actual_height),
                ];
            }
            if (count($members) < 2) continue;
            $vertical = ($stack['direction'] ?? 'vertical') !== 'horizontal';
            $baseline_start = $vertical
                ? min(array_column($members, 'baselineY'))
                : min(array_column($members, 'baselineX'));
            $baseline_end = $vertical
                ? max(array_map(static fn(array $member): int => $member['baselineY'] + $member['baselineHeight'], $members))
                : max(array_map(static fn(array $member): int => $member['baselineX'] + $member['baselineWidth'], $members));
            $cross_start = $vertical
                ? min(array_column($members, 'baselineX'))
                : min(array_column($members, 'baselineY'));
            $cross_end = $vertical
                ? max(array_map(static fn(array $member): int => $member['baselineX'] + $member['baselineWidth'], $members))
                : max(array_map(static fn(array $member): int => $member['baselineY'] + $member['baselineHeight'], $members));
            $gap = max(0, (float) ($stack['gap'] ?? 0));
            $total_size = array_sum(array_map(
                static fn(array $member): int => $vertical ? $member['height'] : $member['width'],
                $members
            )) + $gap * (count($members) - 1);
            $anchor = (string) ($stack['anchor'] ?? 'center');
            $anchor_point = match ($anchor) {
                'start' => $baseline_start,
                'end' => $baseline_end,
                default => $baseline_start + (($baseline_end - $baseline_start) / 2),
            };
            $cursor = match ($anchor) {
                'start' => $anchor_point,
                'end' => $anchor_point - $total_size,
                default => $anchor_point - ($total_size / 2),
            };
            $align = (string) ($stack['align'] ?? 'start');
            foreach ($members as $member) {
                $cross_size = $vertical ? $member['width'] : $member['height'];
                $cross = match ($align) {
                    'end' => $cross_end - $cross_size,
                    'center' => $cross_start + (($cross_end - $cross_start - $cross_size) / 2),
                    default => $cross_start,
                };
                $placements[$member['id']] = [
                    'x' => (int) round($vertical ? $cross : $cursor),
                    'y' => (int) round($vertical ? $cursor : $cross),
                    'width' => (int) $member['width'],
                    'height' => (int) $member['height'],
                ];
                $claimed[$member['id']] = true;
                $cursor += ($vertical ? $member['height'] : $member['width']) + $gap;
            }
        }
        return $placements;
    }

    private static function layer_width_pixels(array $layer, int $container_width): int {
        if (($layer['widthUnit'] ?? 'px') === 'percent') {
            return max(1, min(
                self::MAX_CANVAS_SIDE,
                (int) round($container_width * (float) ($layer['width'] ?? 100) / 100)
            ));
        }
        return max(1, min(self::MAX_CANVAS_SIDE, (int) round((float) ($layer['width'] ?? 1))));
    }

    /** @return array{0:int,1:int} */
    private static function anchored_layer_position(
        array $layer,
        int $container_width,
        int $container_height,
        int $actual_width,
        int $actual_height,
        float $offset_x = 0,
        float $offset_y = 0
    ): array {
        $x_offset = (float) ($layer['x'] ?? 0);
        $y_offset = (float) ($layer['y'] ?? 0);
        $x = match ($layer['horizontalAnchor'] ?? 'left') {
            'center' => ($container_width / 2) + $x_offset - ($actual_width / 2),
            'right' => $container_width - $x_offset - $actual_width,
            default => $x_offset,
        };
        $y = match ($layer['verticalAnchor'] ?? 'top') {
            'center' => ($container_height / 2) + $y_offset - ($actual_height / 2),
            'bottom' => $container_height - $y_offset - $actual_height,
            default => $y_offset,
        };
        return [
            (int) round($offset_x + $x),
            (int) round($offset_y + $y),
        ];
    }

    private function render_layer_surface(
        array $layer,
        WP_Post $post,
        int $width,
        int $container_height,
        ?int $height_override = null
    ): mixed {
        $height = $height_override ?? (int) $layer['height'];
        $text = '';
        if ($layer['type'] === 'text') {
            $text = $this->text_layer_value($layer, $post);
            if (!empty($layer['autoHeight']) && $height_override === null) {
                $height = $this->fit_text_height(
                    $text,
                    $layer,
                    $width,
                    self::auto_height_limit(
                        $container_height,
                        (float) ($layer['y'] ?? 0),
                        (string) ($layer['verticalAnchor'] ?? 'top')
                    )
                );
                if (is_wp_error($height)) return $height;
            }
        }
        $surface = $this->transparent_image($width, $height);
        if (!$surface) return new WP_Error('kodety_social_layer', 'Não foi possível criar uma layer GD.');
        $type = $layer['type'];
        if ($type === 'shape') {
            if ($layer['shape'] === 'line') {
                $color = $layer['fill']['type'] === 'solid'
                    ? (string) $layer['fill']['color']
                    : (string) ($layer['fill']['stops'][0]['color'] ?? '#000000');
                $thickness = max(1, (int) ($layer['border']['width'] ?: min($height, 4)));
                imagesetthickness($surface, $thickness);
                imageline(
                    $surface,
                    0,
                    (int) floor($height / 2),
                    max(0, $width - 1),
                    (int) floor($height / 2),
                    $this->allocate_color($surface, $color)
                );
                imagesetthickness($surface, 1);
            } else {
                $this->draw_paint($surface, $layer['fill'], $width, $height);
                if ($layer['shape'] === 'ellipse') $this->apply_ellipse_mask($surface);
                elseif ($layer['radius'] > 0) $this->apply_rounded_mask($surface, (int) round($layer['radius']));
            }
        } elseif ($type === 'image') {
            $source = $this->image_layer_source($layer, $post);
            $dynamic_source = $layer['variable'] !== '' || str_contains((string) $layer['src'], '{{');
            $attachment_id = $dynamic_source ? 0 : (int) $layer['attachmentId'];
            $path = $this->local_image_path($source, $attachment_id);
            if ($path === null) {
                imagedestroy($surface);
                return null;
            }
            $source_image = $this->load_image($path);
            if (is_wp_error($source_image)) {
                imagedestroy($surface);
                return $source_image;
            }
            $this->draw_fitted_image($surface, $source_image, $layer);
            imagedestroy($source_image);
            if ($layer['radius'] > 0) $this->apply_rounded_mask($surface, (int) round($layer['radius']));
        } elseif ($type === 'text') {
            $text_result = $this->draw_text($surface, $text, $layer, $post);
            if (is_wp_error($text_result)) {
                imagedestroy($surface);
                return $text_result;
            }
        } elseif ($type === 'icon') {
            $this->draw_icon($surface, $layer);
        }
        if (($layer['border']['width'] ?? 0) > 0) $this->draw_border($surface, $layer);
        return $surface;
    }

    private function text_layer_value(array $layer, WP_Post $post): string {
        $text = (string) ($layer['text'] ?? '');
        if ($text === '' && ($layer['variable'] ?? '') !== '') {
            return $this->scalar_value($this->resolve_variable_for_post((string) $layer['variable'], $post));
        }
        return $this->resolve_template_string($text, $post);
    }

    private function image_layer_source(array $layer, WP_Post $post): mixed {
        if ($layer['variable'] !== '') {
            $value = $this->resolve_variable_for_post($layer['variable'], $post);
            return $layer['variable'] === 'author.avatar'
                ? ['url' => $this->scalar_value($value), 'trustedRemote' => 'avatar']
                : $value;
        }
        $source = (string) $layer['src'];
        if (preg_match('/^\s*\{\{\s*([^{}]+)\s*\}\}\s*$/D', $source, $match)) {
            $token = trim((string) $match[1]);
            $value = $this->resolve_variable_for_post($token, $post);
            return $token === 'author.avatar'
                ? ['url' => $this->scalar_value($value), 'trustedRemote' => 'avatar']
                : $value;
        }
        return $this->resolve_template_string($source, $post);
    }

    private function background_image_source(array $template, WP_Post $post): mixed {
        $source = (string) ($template['backgroundImage'] ?? '');
        if (preg_match('/^\s*\{\{\s*([^{}]+)\s*\}\}\s*$/D', $source, $match)) {
            $token = trim((string) $match[1]);
            $value = $this->resolve_variable_for_post($token, $post);
            return $token === 'author.avatar'
                ? ['url' => $this->scalar_value($value), 'trustedRemote' => 'avatar']
                : $value;
        }
        return $this->resolve_template_string($source, $post);
    }

    private function resolve_template_string(string $template, WP_Post $post): string {
        if (!str_contains($template, '{{')) return $template;
        return (string) preg_replace_callback('/\{\{([^{}]+)\}\}/', function (array $match) use ($post): string {
            return $this->scalar_value($this->resolve_variable_for_post(trim((string) $match[1]), $post));
        }, $template);
    }

    private function scalar_value(mixed $value): string {
        if (is_array($value)) {
            foreach (['url', 'value', 'label', 'name'] as $key) if (isset($value[$key]) && is_scalar($value[$key])) return (string) $value[$key];
            return implode(', ', array_map(fn(mixed $item): string => $this->scalar_value($item), $value));
        }
        if ($value instanceof WP_Post) return get_the_title($value);
        return is_scalar($value) ? (string) $value : '';
    }

    private function transparent_image(int $width, int $height): mixed {
        $image = imagecreatetruecolor($width, $height);
        if (!$image) return null;
        imagealphablending($image, false);
        imagesavealpha($image, true);
        imagefill($image, 0, 0, imagecolorallocatealpha($image, 0, 0, 0, 127));
        imagealphablending($image, true);
        return $image;
    }

    private function draw_paint(mixed $image, array $paint, int $width, int $height): void {
        if (($paint['type'] ?? 'solid') !== 'linear-gradient') {
            imagefilledrectangle($image, 0, 0, $width, $height, $this->allocate_color($image, (string) ($paint['color'] ?? '#ffffff')));
            return;
        }
        $stops = $paint['stops'];
        $angle = deg2rad((float) $paint['angle']);
        $direction_x = sin($angle);
        $direction_y = -cos($angle);
        $corners = [
            0,
            ($width - 1) * $direction_x,
            ($height - 1) * $direction_y,
            ($width - 1) * $direction_x + ($height - 1) * $direction_y,
        ];
        $minimum = min($corners);
        $range = max(0.0001, max($corners) - $minimum);
        $cache = [];
        for ($y = 0; $y < $height; $y++) {
            for ($x = 0; $x < $width; $x++) {
                $position = (($x * $direction_x + $y * $direction_y) - $minimum) / $range;
                $bucket = max(0, min(255, (int) round($position * 255)));
                if (!isset($cache[$bucket])) {
                    $cache[$bucket] = $this->gradient_color($image, $stops, $bucket / 255);
                }
                imagesetpixel($image, $x, $y, $cache[$bucket]);
            }
        }
    }

    private function gradient_color(mixed $image, array $stops, float $position): int {
        $left = $stops[0];
        $right = $stops[count($stops) - 1];
        foreach ($stops as $index => $stop) {
            if ($stop['offset'] <= $position) $left = $stop;
            if ($stop['offset'] >= $position) {
                $right = $stop;
                break;
            }
        }
        $distance = max(0.0001, (float) $right['offset'] - (float) $left['offset']);
        $ratio = max(0, min(1, ($position - (float) $left['offset']) / $distance));
        $from = $this->rgba((string) $left['color']);
        $to = $this->rgba((string) $right['color']);
        $channels = [];
        for ($index = 0; $index < 4; $index++) $channels[$index] = (int) round($from[$index] + ($to[$index] - $from[$index]) * $ratio);
        return imagecolorallocatealpha($image, $channels[0], $channels[1], $channels[2], $channels[3]);
    }

    private function draw_fitted_image(mixed $target, mixed $source, array $layer): void {
        $source_width = imagesx($source);
        $source_height = imagesy($source);
        $target_width = imagesx($target);
        $target_height = imagesy($target);
        if ($source_width < 1 || $source_height < 1) return;
        if ($layer['fit'] === 'fill') {
            imagecopyresampled($target, $source, 0, 0, 0, 0, $target_width, $target_height, $source_width, $source_height);
            return;
        }
        $scale = $layer['fit'] === 'contain'
            ? min($target_width / $source_width, $target_height / $source_height)
            : max($target_width / $source_width, $target_height / $source_height);
        $render_width = max(1, (int) round($source_width * $scale));
        $render_height = max(1, (int) round($source_height * $scale));
        if ($layer['fit'] === 'contain') {
            $destination_x = (int) round(($target_width - $render_width) * ((float) $layer['focalX'] / 100));
            $destination_y = (int) round(($target_height - $render_height) * ((float) $layer['focalY'] / 100));
            imagecopyresampled($target, $source, $destination_x, $destination_y, 0, 0, $render_width, $render_height, $source_width, $source_height);
            return;
        }
        $visible_source_width = $target_width / $scale;
        $visible_source_height = $target_height / $scale;
        $source_x = (int) round(($source_width - $visible_source_width) * ((float) $layer['focalX'] / 100));
        $source_y = (int) round(($source_height - $visible_source_height) * ((float) $layer['focalY'] / 100));
        imagecopyresampled(
            $target,
            $source,
            0,
            0,
            max(0, $source_x),
            max(0, $source_y),
            $target_width,
            $target_height,
            max(1, (int) round($visible_source_width)),
            max(1, (int) round($visible_source_height))
        );
    }

    private function fit_text_height(
        string $text,
        array $layer,
        int $width,
        int $maximum_height
    ): int|WP_Error {
        $text = self::text(wp_strip_all_tags($text), self::MAX_TEXT_BYTES);
        if ($text === '') {
            // The browser preview keeps an empty fit-content text layer at one
            // line via a non-breaking-space placeholder. Mirror that geometry
            // even though there are no glyphs to draw server-side.
            $css_font_size = (float) $layer['fontSize'];
            $line_height = (float) $layer['lineHeight'];
            if ($line_height <= 4) $line_height *= $css_font_size;
            $line_height = max($css_font_size * 0.7, $line_height);
            return min(max(1, $maximum_height), max(1, (int) ceil($line_height)));
        }
        $font = $this->font_path($layer);
        if ($font === '' || !function_exists('imagettfbbox')) {
            return new WP_Error(
                'kodety_social_freetype_missing',
                'GD com suporte a FreeType e a fonte TTF/OTF usada pelo template são necessários para renderizar texto.'
            );
        }
        $css_font_size = (float) $layer['fontSize'];
        $font_size = $css_font_size * self::CSS_PIXEL_TO_POINT;
        $letter_spacing = (float) $layer['letterSpacing'];
        $synthetic_bold = self::synthetic_font_stroke($layer);
        try {
            $lines = $this->wrap_ttf_text(
                $text,
                $font,
                $font_size,
                max(1, $width - $synthetic_bold),
                $letter_spacing
            );
        } catch (Throwable) {
            return new WP_Error(
                'kodety_social_font_invalid',
                'A fonte TTF/OTF usada pelo template não pôde ser processada com segurança.'
            );
        }
        $line_height = (float) $layer['lineHeight'];
        if ($line_height <= 4) $line_height *= $css_font_size;
        $line_height = max($css_font_size * 0.7, $line_height);
        $content_height = max(1, (int) ceil(count($lines) * $line_height));
        return min(max(1, $maximum_height), $content_height);
    }

    private function draw_text(mixed $surface, string $text, array $layer, WP_Post $post): bool|WP_Error {
        unset($post);
        $text = self::text(wp_strip_all_tags($text), self::MAX_TEXT_BYTES);
        if ($text === '') return true;
        $font = $this->font_path($layer);
        if ($font === '' || !function_exists('imagettftext') || !function_exists('imagettfbbox')) {
            return new WP_Error(
                'kodety_social_freetype_missing',
                'GD com suporte a FreeType e a fonte TTF/OTF usada pelo template são necessários para renderizar texto.'
            );
        }
        $css_font_size = (float) $layer['fontSize'];
        $font_size = $css_font_size * self::CSS_PIXEL_TO_POINT;
        $letter_spacing = (float) $layer['letterSpacing'];
        $color = $layer['fill']['type'] === 'solid'
            ? (string) $layer['fill']['color']
            : (string) ($layer['fill']['stops'][0]['color'] ?? '#111111');
        $allocated = $this->allocate_color($surface, $color);
        $width = imagesx($surface);
        $height = imagesy($surface);

        $synthetic_bold = self::synthetic_font_stroke($layer);
        try {
            $lines = $this->wrap_ttf_text(
                $text,
                $font,
                $font_size,
                max(1, $width - $synthetic_bold),
                $letter_spacing
            );
        } catch (Throwable) {
            return new WP_Error(
                'kodety_social_font_invalid',
                'A fonte TTF/OTF usada pelo template não pôde ser processada com segurança.'
            );
        }
        $line_height = (float) $layer['lineHeight'];
        if ($line_height <= 4) $line_height *= $css_font_size;
        $line_height = max($css_font_size * 0.7, $line_height);
        $block_height = count($lines) * $line_height;
        $top = match ($layer['verticalAlign']) {
            'center' => max(0, ($height - $block_height) / 2),
            'bottom' => max(0, $height - $block_height),
            default => 0,
        };
        $draw_glyphs = static function (
            string $value,
            int $x,
            int $baseline
        ) use ($surface, $font_size, $allocated, $font, $synthetic_bold): void {
            for ($offset = 0; $offset <= $synthetic_bold; $offset++) {
                $result = @imagettftext(
                    $surface,
                    $font_size,
                    0,
                    $x + $offset,
                    $baseline,
                    $allocated,
                    $font,
                    $value
                );
                if ($result === false) {
                    throw new RuntimeException('FreeType recusou a fonte local.');
                }
            }
        };
        try {
            foreach ($lines as $index => $line) {
                $line_width = $this->ttf_text_width($line, $font, $font_size, $letter_spacing) + $synthetic_bold;
                $x = match ($layer['textAlign']) {
                    'center' => max(0, ($width - $line_width) / 2),
                    'right' => max(0, $width - $line_width),
                    default => 0,
                };
                $baseline = $top + ($index * $line_height) + $font_size;
                if (abs($letter_spacing) < 0.01) {
                    $draw_glyphs($line, (int) round($x), (int) round($baseline));
                } else {
                    foreach (self::text_graphemes($line) as $character) {
                        $draw_glyphs($character, (int) round($x), (int) round($baseline));
                        $x += $this->ttf_text_width($character, $font, $font_size, 0) + $letter_spacing;
                    }
                }
            }
        } catch (Throwable) {
            return new WP_Error(
                'kodety_social_font_invalid',
                'A fonte TTF/OTF usada pelo template não pôde ser processada com segurança.'
            );
        }
        return true;
    }

    private function wrap_ttf_text(string $text, string $font, float $font_size, int $width, float $letter_spacing): array {
        $lines = [];
        foreach (preg_split('/\R/u', $text) ?: [] as $paragraph) {
            $words = preg_split('/\s+/u', trim($paragraph), -1, PREG_SPLIT_NO_EMPTY) ?: [];
            if (!$words) {
                $lines[] = '';
                continue;
            }
            $line = '';
            foreach ($words as $word) {
                if ($this->ttf_text_width($word, $font, $font_size, $letter_spacing) > $width) {
                    if ($line !== '') {
                        $lines[] = $line;
                        $line = '';
                    }
                    $fragments = $this->break_ttf_word(
                        $word,
                        $font,
                        $font_size,
                        $width,
                        $letter_spacing
                    );
                    $line = (string) array_pop($fragments);
                    foreach ($fragments as $fragment) $lines[] = $fragment;
                    continue;
                }
                $candidate = $line === '' ? $word : $line . ' ' . $word;
                if ($line !== '' && $this->ttf_text_width($candidate, $font, $font_size, $letter_spacing) > $width) {
                    $lines[] = $line;
                    $line = $word;
                } else {
                    $line = $candidate;
                }
            }
            $lines[] = $line;
        }
        return array_slice($lines ?: [''], 0, 100);
    }

    /** @return array<int,string> */
    private function break_ttf_word(
        string $word,
        string $font,
        float $font_size,
        int $width,
        float $letter_spacing
    ): array {
        $fragments = [];
        $fragment = '';
        foreach (self::text_graphemes($word) as $grapheme) {
            $candidate = $fragment . $grapheme;
            if ($fragment !== ''
                && $this->ttf_text_width($candidate, $font, $font_size, $letter_spacing) > $width) {
                $fragments[] = $fragment;
                $fragment = $grapheme;
            } else {
                $fragment = $candidate;
            }
        }
        if ($fragment !== '' || !$fragments) $fragments[] = $fragment;
        return $fragments;
    }

    /** @return array<int,string> */
    private static function text_graphemes(string $text): array {
        $matched = preg_match_all('/\X/u', $text, $matches);
        if (is_int($matched) && $matched > 0 && is_array($matches[0] ?? null)) {
            return $matches[0];
        }
        return preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    }

    private function ttf_text_width(string $text, string $font, float $font_size, float $letter_spacing): float {
        $box = @imagettfbbox($font_size, 0, $font, $text);
        if (!is_array($box)) {
            throw new RuntimeException('FreeType recusou a fonte local.');
        }
        $width = abs((float) $box[2] - (float) $box[0]);
        return $width + max(0, count(self::text_graphemes($text)) - 1) * $letter_spacing;
    }

    private function font_path(array $layer): string {
        $project_font = self::local_font_path((string) ($layer['fontFile'] ?? ''));
        if ($project_font !== '') {
            $resolved = $this->local_asset_path($project_font, ['ttf', 'otf']);
            return is_string($resolved) && self::valid_sfnt_font($resolved) ? $resolved : '';
        }
        $base = defined('KODETY_DIR') ? rtrim(KODETY_DIR, '/\\') : dirname(__DIR__);
        $font = $base . '/assets/fonts/geist-regular.ttf';
        return self::valid_sfnt_font($font) ? $font : '';
    }

    private static function valid_sfnt_font(string $font): bool {
        if (!is_file($font) || is_link($font)) return false;
        $size = @filesize($font);
        if (!is_int($size) || $size < 12 || $size > self::MAX_FONT_BYTES) return false;
        $handle = @fopen($font, 'rb');
        if (!is_resource($handle)) return false;
        try {
            $signature = @fread($handle, 4);
        } finally {
            fclose($handle);
        }
        return is_string($signature) && in_array(
            $signature,
            ["\x00\x01\x00\x00", 'OTTO', 'true', 'typ1'],
            true
        );
    }

    private function local_image_path(mixed $source, int $attachment_id = 0): ?string {
        $trusted_remote = '';
        if (is_array($source)) {
            if (isset($source['id']) && is_numeric($source['id'])) $attachment_id = absint($source['id']);
            $trusted_remote = (string) ($source['trustedRemote'] ?? '');
            $source = $source['url'] ?? $source['value'] ?? '';
        }
        if (is_numeric($source) && absint($source) > 0) $attachment_id = absint($source);
        if ($attachment_id > 0) {
            $path = get_attached_file($attachment_id);
            if (is_string($path) && $this->path_in_allowed_root($path)) return $path;
            // A template may outlive an imported WordPress attachment. Keep
            // resolving its canonical local source instead of dropping an
            // otherwise valid image because the old media ID became stale.
        }
        $source = trim((string) $source);
        if ($source === '') return null;
        if (preg_match('~^https?://~i', $source)) {
            $attachment_id = function_exists('attachment_url_to_postid') ? absint(attachment_url_to_postid($source)) : 0;
            if ($attachment_id > 0) {
                $path = get_attached_file($attachment_id);
                return is_string($path) && $this->path_in_allowed_root($path) ? $path : null;
            }
            $uploads = wp_upload_dir();
            $baseurl = rtrim((string) ($uploads['baseurl'] ?? ''), '/');
            if ($baseurl !== '' && ($source === $baseurl || str_starts_with($source, $baseurl . '/'))) {
                $relative = rawurldecode(ltrim(substr($source, strlen($baseurl)), '/'));
                $candidate = rtrim((string) $uploads['basedir'], '/\\') . '/' . $relative;
                return $this->path_in_root($candidate, (string) $uploads['basedir']) ? realpath($candidate) ?: null : null;
            }
            if ($trusted_remote === 'avatar') return $this->cached_remote_avatar_path($source);
            // Authored external image URLs are never fetched server-side.
            return null;
        }
        return $this->local_asset_path($source, ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);
    }

    /**
     * Gravatar is the sole remote-image exception. The URL originates from
     * WordPress' author resolver, is allowlisted, has no redirects and is
     * downloaded through the SSRF-safe HTTP API into a bounded local cache.
     */
    private function cached_remote_avatar_path(string $url): ?string {
        if (!function_exists('wp_safe_remote_get')
            || !function_exists('wp_remote_retrieve_response_code')
            || !function_exists('wp_remote_retrieve_body')
            || !function_exists('wp_upload_dir')) return null;
        $parts = wp_parse_url($url);
        if (!is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || !isset($parts['host'])) return null;
        $host = strtolower(rtrim((string) $parts['host'], '.'));
        if (!in_array($host, [
            'gravatar.com',
            'www.gravatar.com',
            'secure.gravatar.com',
            '0.gravatar.com',
            '1.gravatar.com',
            '2.gravatar.com',
        ], true)) return null;
        $path = (string) ($parts['path'] ?? '');
        if ($path !== '/avatar' && !str_starts_with($path, '/avatar/')) return null;

        $uploads = wp_upload_dir();
        if (!empty($uploads['error']) || empty($uploads['basedir'])) return null;
        $directory = rtrim((string) $uploads['basedir'], '/\\') . '/kodety/social-cache';
        if (!is_dir($directory) && (!function_exists('wp_mkdir_p') || !wp_mkdir_p($directory))) return null;
        if (!$this->path_in_root($directory, (string) $uploads['basedir'])) return null;
        $target = $directory . '/avatar-' . hash('sha256', $url) . '.img';
        $stale = is_file($target) && !is_link($target)
            && ($size = filesize($target)) !== false
            && $size > 0
            && $size <= self::MAX_REMOTE_AVATAR_BYTES;
        if ($stale && filemtime($target) >= time() - 86400) return realpath($target) ?: null;

        $response = wp_safe_remote_get($url, [
            'timeout' => 5,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'limit_response_size' => self::MAX_REMOTE_AVATAR_BYTES,
            'headers' => ['Accept' => 'image/png,image/jpeg,image/webp,image/gif'],
        ]);
        if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
            return $stale ? (realpath($target) ?: null) : null;
        }
        $body = wp_remote_retrieve_body($response);
        if (!is_string($body) || $body === '' || strlen($body) > self::MAX_REMOTE_AVATAR_BYTES) {
            return $stale ? (realpath($target) ?: null) : null;
        }
        $info = @getimagesizefromstring($body);
        if (!is_array($info)
            || empty($info[0])
            || empty($info[1])
            || ((int) $info[0] * (int) $info[1]) > self::MAX_SOURCE_PIXELS
            || !in_array((string) ($info['mime'] ?? ''), ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], true)) {
            return $stale ? (realpath($target) ?: null) : null;
        }
        $temporary = tempnam($directory, '.kodety-avatar-');
        if (!is_string($temporary) || $temporary === '') return $stale ? (realpath($target) ?: null) : null;
        $written = file_put_contents($temporary, $body, LOCK_EX);
        if ($written !== strlen($body) || !rename($temporary, $target)) {
            @unlink($temporary);
            return $stale ? (realpath($target) ?: null) : null;
        }
        @chmod($target, 0644 & ~umask());
        return realpath($target) ?: null;
    }

    private function local_asset_path(string $source, array $extensions): ?string {
        $source = preg_replace('/[?#].*$/', '', trim($source)) ?: '';
        $decoded = str_replace('\\', '/', rawurldecode($source));
        if ($decoded === ''
            || str_contains($decoded, "\0")
            || preg_match('~(?:^|/)\.\.(?:/|$)~', $decoded)) return null;
        $extension = strtolower(pathinfo($decoded, PATHINFO_EXTENSION));
        if (!in_array($extension, $extensions, true)) return null;
        if (preg_match('~^(?:[a-z][a-z0-9+.-]*:|//)~i', $decoded)) return null;
        $relative = ltrim($decoded, '/');
        if (!function_exists('get_template_directory')) return null;
        $theme = (string) get_template_directory();
        $candidates = [$theme . '/site/' . $relative];
        $manifest_path = $theme . '/manifest.json';
        if (is_file($manifest_path) && !is_link($manifest_path)) {
            $manifest_size = filesize($manifest_path);
            $manifest = is_int($manifest_size) && $manifest_size > 1 && $manifest_size <= 2_000_000
                ? json_decode((string) file_get_contents($manifest_path), true)
                : null;
            $main_html = is_array($manifest) && is_string($manifest[''] ?? null)
                ? ltrim(str_replace('\\', '/', trim($manifest[''])), '/')
                : '';
            if ($main_html !== ''
                && !str_contains($main_html, "\0")
                && !preg_match('~(?:^|/)\.\.(?:/|$)~', $main_html)
                && !preg_match('~^(?:[a-z][a-z0-9+.-]*:|//)~i', $main_html)) {
                $web_root = trim(str_replace('\\', '/', dirname($main_html)), './');
                if ($web_root !== '') $candidates[] = $theme . '/site/' . $web_root . '/' . $relative;
            }
        }
        $candidates[] = $theme . '/' . $relative;
        foreach (array_unique($candidates) as $candidate) {
            if ($this->path_in_root($candidate, $theme) && is_file($candidate) && !is_link($candidate)) return realpath($candidate) ?: null;
        }
        return null;
    }

    private function path_in_allowed_root(string $path): bool {
        $uploads = wp_upload_dir();
        if (!empty($uploads['basedir']) && $this->path_in_root($path, (string) $uploads['basedir'])) return true;
        return function_exists('get_template_directory') && $this->path_in_root($path, (string) get_template_directory());
    }

    private function path_in_root(string $path, string $root): bool {
        $real_path = realpath($path);
        $real_root = realpath($root);
        if (!is_string($real_path) || !is_string($real_root)) return false;
        $real_path = rtrim(str_replace('\\', '/', $real_path), '/');
        $real_root = rtrim(str_replace('\\', '/', $real_root), '/');
        return $real_path === $real_root || str_starts_with($real_path, $real_root . '/');
    }

    private function load_image(string $path): mixed {
        if (!is_file($path) || is_link($path)) return new WP_Error('kodety_social_image_missing', 'Uma imagem usada pelo template não está disponível.');
        $size = filesize($path);
        if (!is_int($size) || $size < 1 || $size > self::MAX_ASSET_BYTES) {
            return new WP_Error('kodety_social_image_size', 'Uma imagem do template excede o limite permitido.');
        }
        $info = @getimagesize($path);
        if (!is_array($info) || empty($info[0]) || empty($info[1]) || ((int) $info[0] * (int) $info[1]) > self::MAX_SOURCE_PIXELS) {
            return new WP_Error('kodety_social_image_dimensions', 'Uma imagem do template possui dimensões inválidas.');
        }
        $loader = match ((string) ($info['mime'] ?? '')) {
            'image/jpeg' => 'imagecreatefromjpeg',
            'image/png' => 'imagecreatefrompng',
            'image/gif' => 'imagecreatefromgif',
            'image/webp' => 'imagecreatefromwebp',
            'image/avif' => 'imagecreatefromavif',
            default => '',
        };
        if ($loader === '' || !function_exists($loader)) {
            return new WP_Error('kodety_social_image_format', 'O GD desta hospedagem não suporta uma imagem usada pelo template.');
        }
        $image = @$loader($path);
        if (!$image) return new WP_Error('kodety_social_image_decode', 'Não foi possível decodificar uma imagem usada pelo template.');
        imagealphablending($image, true);
        imagesavealpha($image, true);
        return $image;
    }

    /** Draw the canonical editor's small Lucide-style icon set without SVG/network IO. */
    private function draw_icon(mixed $image, array $layer): void {
        $width = imagesx($image);
        $height = imagesy($image);
        if ($width < 2 || $height < 2) return;
        $color = $layer['fill']['type'] === 'solid'
            ? (string) $layer['fill']['color']
            : (string) ($layer['fill']['stops'][0]['color'] ?? '#ffffff');
        $allocated = $this->allocate_color($image, $color);
        $thickness = max(1, (int) round((float) $layer['strokeWidth'] * min($width, $height) / 24));
        imagesetthickness($image, $thickness);
        if (function_exists('imageantialias')) imageantialias($image, true);

        $point = static fn(float $x, float $y): array => [
            (int) round($x * ($width - 1)),
            (int) round($y * ($height - 1)),
        ];
        $path = function (array $points, bool $closed = false) use ($image, $allocated, $point): void {
            $pixels = array_map(static fn(array $pair): array => $point($pair[0], $pair[1]), $points);
            if ($closed && $pixels) $pixels[] = $pixels[0];
            for ($index = 1, $count = count($pixels); $index < $count; $index++) {
                imageline(
                    $image,
                    $pixels[$index - 1][0],
                    $pixels[$index - 1][1],
                    $pixels[$index][0],
                    $pixels[$index][1],
                    $allocated
                );
            }
        };

        switch ($layer['icon']) {
            case 'star':
                $points = [];
                for ($index = 0; $index < 10; $index++) {
                    $angle = deg2rad(-90 + $index * 36);
                    $radius = $index % 2 === 0 ? 0.42 : 0.19;
                    $points[] = [0.5 + cos($angle) * $radius, 0.5 + sin($angle) * $radius];
                }
                $path($points, true);
                break;
            case 'heart':
                $path([
                    [0.5, 0.84], [0.16, 0.55], [0.1, 0.37], [0.13, 0.22],
                    [0.25, 0.13], [0.39, 0.17], [0.5, 0.3], [0.61, 0.17],
                    [0.75, 0.13], [0.87, 0.22], [0.9, 0.37], [0.84, 0.55],
                ], true);
                break;
            case 'arrow-up-right':
                $path([[0.18, 0.82], [0.82, 0.18]]);
                $path([[0.44, 0.18], [0.82, 0.18], [0.82, 0.56]]);
                break;
            case 'check':
                $path([[0.14, 0.52], [0.39, 0.76], [0.86, 0.24]]);
                break;
            case 'play':
                $path([[0.3, 0.14], [0.78, 0.5], [0.3, 0.86]], true);
                break;
            default:
                $path([[0.5, 0.08], [0.57, 0.37], [0.82, 0.5], [0.57, 0.63], [0.5, 0.92], [0.43, 0.63], [0.18, 0.5], [0.43, 0.37]], true);
                $path([[0.8, 0.08], [0.8, 0.28]]);
                $path([[0.7, 0.18], [0.9, 0.18]]);
                $path([[0.2, 0.72], [0.2, 0.9]]);
                $path([[0.11, 0.81], [0.29, 0.81]]);
                break;
        }
        imagesetthickness($image, 1);
    }

    private function draw_border(mixed $image, array $layer): void {
        if (($layer['type'] ?? '') === 'shape' && ($layer['shape'] ?? '') === 'line') return;
        $width = (int) $layer['border']['width'];
        $color = $this->allocate_color($image, (string) $layer['border']['color']);
        $right = imagesx($image) - 1;
        $bottom = imagesy($image) - 1;
        for ($offset = 0; $offset < $width && $offset <= min($right, $bottom) / 2; $offset++) {
            if (($layer['shape'] ?? '') === 'ellipse') {
                imageellipse($image, (int) ($right / 2), (int) ($bottom / 2), max(1, $right - 2 * $offset), max(1, $bottom - 2 * $offset), $color);
            } elseif (($layer['radius'] ?? 0) > 0) {
                $radius = max(1, min(
                    (int) round((float) $layer['radius']) - $offset,
                    (int) floor(min($right, $bottom) / 2) - $offset
                ));
                $left = $offset;
                $top = $offset;
                $x2 = $right - $offset;
                $y2 = $bottom - $offset;
                imageline($image, $left + $radius, $top, $x2 - $radius, $top, $color);
                imageline($image, $left + $radius, $y2, $x2 - $radius, $y2, $color);
                imageline($image, $left, $top + $radius, $left, $y2 - $radius, $color);
                imageline($image, $x2, $top + $radius, $x2, $y2 - $radius, $color);
                imagearc($image, $left + $radius, $top + $radius, $radius * 2, $radius * 2, 180, 270, $color);
                imagearc($image, $x2 - $radius, $top + $radius, $radius * 2, $radius * 2, 270, 360, $color);
                imagearc($image, $x2 - $radius, $y2 - $radius, $radius * 2, $radius * 2, 0, 90, $color);
                imagearc($image, $left + $radius, $y2 - $radius, $radius * 2, $radius * 2, 90, 180, $color);
            } else {
                imagerectangle($image, $offset, $offset, $right - $offset, $bottom - $offset, $color);
            }
        }
    }

    private function apply_ellipse_mask(mixed $image): void {
        $width = imagesx($image);
        $height = imagesy($image);
        $center_x = ($width - 1) / 2;
        $center_y = ($height - 1) / 2;
        $radius_x = max(0.5, $width / 2);
        $radius_y = max(0.5, $height / 2);
        imagealphablending($image, false);
        $transparent = imagecolorallocatealpha($image, 0, 0, 0, 127);
        for ($y = 0; $y < $height; $y++) {
            for ($x = 0; $x < $width; $x++) {
                $distance = (($x - $center_x) ** 2) / ($radius_x ** 2) + (($y - $center_y) ** 2) / ($radius_y ** 2);
                if ($distance > 1) imagesetpixel($image, $x, $y, $transparent);
            }
        }
        imagealphablending($image, true);
    }

    private function apply_rounded_mask(mixed $image, int $radius): void {
        $width = imagesx($image);
        $height = imagesy($image);
        $radius = max(0, min($radius, (int) floor(min($width, $height) / 2)));
        if ($radius <= 0) return;
        imagealphablending($image, false);
        $transparent = imagecolorallocatealpha($image, 0, 0, 0, 127);
        for ($y = 0; $y < $radius; $y++) {
            for ($x = 0; $x < $radius; $x++) {
                $dx = $radius - $x - 0.5;
                $dy = $radius - $y - 0.5;
                if (($dx * $dx + $dy * $dy) <= ($radius * $radius)) continue;
                imagesetpixel($image, $x, $y, $transparent);
                imagesetpixel($image, $width - 1 - $x, $y, $transparent);
                imagesetpixel($image, $x, $height - 1 - $y, $transparent);
                imagesetpixel($image, $width - 1 - $x, $height - 1 - $y, $transparent);
            }
        }
        imagealphablending($image, true);
    }

    private function shadow_surface(mixed $source, array $shadow): mixed {
        $source_width = imagesx($source);
        $source_height = imagesy($source);
        $padding = min(64, max(0, (int) ceil((int) $shadow['blur'] * 1.5)));
        $width = $source_width + 2 * $padding;
        $height = $source_height + 2 * $padding;
        if ($width <= 0 || $height <= 0 || $width * $height > self::MAX_LAYER_PIXELS) {
            return new WP_Error(
                'kodety_social_shadow_budget',
                'A sombra excede o limite seguro de pixels de uma layer.'
            );
        }
        $result = $this->transparent_image($width, $height);
        if (!$result) return null;
        [$red, $green, $blue, $base_alpha] = $this->rgba((string) $shadow['color']);
        imagealphablending($result, false);
        for ($y = 0; $y < $source_height; $y++) {
            for ($x = 0; $x < $source_width; $x++) {
                $source_color = imagecolorat($source, $x, $y);
                $source_alpha = ($source_color >> 24) & 0x7F;
                if ($source_alpha >= 127) continue;
                $visible = (1 - $source_alpha / 127)
                    * (1 - $base_alpha / 127)
                    * (float) ($shadow['opacity'] ?? 1);
                $alpha = 127 - (int) round(127 * $visible);
                imagesetpixel(
                    $result,
                    $x + $padding,
                    $y + $padding,
                    imagecolorallocatealpha($result, $red, $green, $blue, max(0, min(127, $alpha)))
                );
            }
        }
        imagealphablending($result, true);
        $passes = min(6, (int) ceil((int) $shadow['blur'] / 4));
        if (defined('IMG_FILTER_GAUSSIAN_BLUR')) {
            for ($pass = 0; $pass < $passes; $pass++) imagefilter($result, IMG_FILTER_GAUSSIAN_BLUR);
        }
        return $result;
    }

    private function composite(mixed $canvas, mixed $surface, int $x, int $y, float $opacity, float $rotation): void {
        if ($opacity < 0.999) $this->apply_surface_opacity($surface, $opacity);
        if (abs($rotation) >= 0.01 && function_exists('imagerotate')) {
            $transparent = imagecolorallocatealpha($surface, 0, 0, 0, 127);
            $rotated = imagerotate($surface, -$rotation, $transparent);
            if ($rotated) {
                imagesavealpha($rotated, true);
                $x -= (int) round((imagesx($rotated) - imagesx($surface)) / 2);
                $y -= (int) round((imagesy($rotated) - imagesy($surface)) / 2);
                imagecopy($canvas, $rotated, $x, $y, 0, 0, imagesx($rotated), imagesy($rotated));
                imagedestroy($rotated);
                return;
            }
        }
        imagecopy($canvas, $surface, $x, $y, 0, 0, imagesx($surface), imagesy($surface));
    }

    private function apply_surface_opacity(mixed $image, float $opacity): void {
        $width = imagesx($image);
        $height = imagesy($image);
        imagealphablending($image, false);
        for ($y = 0; $y < $height; $y++) {
            for ($x = 0; $x < $width; $x++) {
                $color = imagecolorat($image, $x, $y);
                $alpha = ($color >> 24) & 0x7F;
                if ($alpha >= 127) continue;
                $red = ($color >> 16) & 0xFF;
                $green = ($color >> 8) & 0xFF;
                $blue = $color & 0xFF;
                $visible = (1 - $alpha / 127) * $opacity;
                $next_alpha = 127 - (int) round($visible * 127);
                imagesetpixel($image, $x, $y, imagecolorallocatealpha($image, $red, $green, $blue, max(0, min(127, $next_alpha))));
            }
        }
        imagealphablending($image, true);
    }

    private function allocate_color(mixed $image, string $color): int {
        [$red, $green, $blue, $alpha] = $this->rgba($color);
        return imagecolorallocatealpha($image, $red, $green, $blue, $alpha);
    }

    /** @return array{0:int,1:int,2:int,3:int} GD alpha uses 0 opaque, 127 transparent. */
    private function rgba(string $color): array {
        $color = self::color($color);
        $digits = substr($color, 1);
        if (strlen($digits) === 6) $digits .= 'ff';
        return [
            hexdec(substr($digits, 0, 2)),
            hexdec(substr($digits, 2, 2)),
            hexdec(substr($digits, 4, 2)),
            127 - (int) round(hexdec(substr($digits, 6, 2)) / 255 * 127),
        ];
    }

    private function acquire_lock(int $post_id): bool {
        if (!function_exists('add_option')) return true;
        $key = 'kodety_social_image_lock_' . $post_id;
        if (add_option($key, time(), '', false)) return true;
        $started = (int) get_option($key, 0);
        if ($started >= time() - self::GENERATION_LOCK_TTL) return false;
        delete_option($key);
        return add_option($key, time(), '', false);
    }

    private function release_lock(int $post_id): void {
        if (function_exists('delete_option')) delete_option('kodety_social_image_lock_' . $post_id);
    }

    private function generation_error(int $post_id, string $code, string $message): WP_Error {
        $message = self::text(sanitize_text_field($message), 1000);
        if ($post_id > 0 && function_exists('update_post_meta')) update_post_meta($post_id, self::META_ERROR, $message);
        return new WP_Error($code, $message);
    }
}
