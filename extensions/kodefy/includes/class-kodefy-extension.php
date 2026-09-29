<?php

namespace Kodefy\Shopify;

defined('ABSPATH') || exit;

final class Kodefy_Extension {
    private const BUILDER_SNAPSHOT_TRANSIENT = 'kodefy_builder_snapshot_v1';
    private const BUILDER_SNAPSHOT_TTL = 300;
    private const PRODUCT_POST_TYPE = 'kodefy_product';
    private const COLLECTION_POST_TYPE = 'kodefy_collection';
    private const CATALOG_SYNC_HOOK = 'kodefy_sync_shopify_catalog';
    private static ?self $instance = null;
    private bool $booted = false;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    public function boot(): void {
        if ($this->booted) return;
        $this->booted = true;
        add_action('init', [$this, 'maybe_upgrade_runtime'], 1);
        add_action('init', [$this, 'ensure_managed_collections'], 4);
        add_action('init', [$this, 'schedule_catalog_sync'], 20);
        add_filter('cron_schedules', [$this, 'catalog_sync_schedule']);
        add_filter('query_vars', [$this, 'dynamic_query_vars']);
        add_action('parse_request', [$this, 'detect_dynamic_route'], 1);
        add_action('wp_enqueue_scripts', [$this, 'runtime_assets']);
        add_action('wp_footer', [$this, 'runtime_config'], 4);
        add_action('rest_api_init', [$this, 'rest_routes']);
        add_filter('kodety_runtime_context', [$this, 'dynamic_runtime_routes'], 20);
        add_filter('kodety_runtime_html', [$this, 'render_managed_seo_html'], 15, 2);
        add_filter('post_type_link', [$this, 'managed_post_permalink'], 20, 2);
        add_filter('kodety_cms_item_permalink', [$this, 'managed_post_permalink'], 20, 2);
        add_filter('redirect_canonical', [$this, 'disable_dynamic_canonical_redirect'], 1, 2);
        add_action('admin_post_kodefy_save_settings', [$this, 'save_settings']);
        add_action('admin_post_kodefy_test_connection', [$this, 'test_connection']);
        add_action('admin_post_kodefy_download_kit', [$this, 'download_kit']);
        add_action(self::CATALOG_SYNC_HOOK, [$this, 'sync_scheduled_catalog']);
        add_filter('kodety_template_library_sources', [$this, 'template_library_sources']);
        add_filter('kodety_builder_apps', [$this, 'builder_apps']);
        add_filter('kodety_editor_shell_config', [$this, 'editor_shell_config'], 10, 2);
    }

    /** @return array<string,mixed> */
    public function settings(): array {
        $settings = \Kodety_Extensions::instance()->get_settings(SLUG, []);
        return is_array($settings) ? $settings : [];
    }

    public static function clear_scheduled_exports(): void {
        wp_clear_scheduled_hook(self::CATALOG_SYNC_HOOK);
    }

    /** Invalidate published HTML once after installing a runtime update. */
    public function maybe_upgrade_runtime(): void {
        $settings = $this->settings();
        if (hash_equals(VERSION, (string) ($settings['runtimeVersion'] ?? ''))) return;
        $settings['runtimeVersion'] = VERSION;
        if (!\Kodety_Extensions::instance()->update_settings(SLUG, $settings)) return;
        delete_transient(self::BUILDER_SNAPSHOT_TRANSIENT);
        $this->purge_published_cache();
        wp_schedule_single_event(time() + 5, self::CATALOG_SYNC_HOOK, ['runtime-upgrade']);
    }

    /** Register the reusable Kodefy storefront templates in the Builder catalog. */
    public function template_library_sources(array $sources): array {
        $sources[] = [
            'schemaVersion' => 1,
            'slug' => 'kodefy-commerce',
            'name' => 'Kodefy Commerce',
            'description' => 'Ecommerce editorial completo para WordPress, pronto para catálogo, estoque, carrinho e checkout Shopify.',
            'category' => 'ecommerce',
            'badge' => 'SHOPIFY',
            'featured' => true,
            'pages' => 13,
            'origin' => 'extension',
            'sourcePath' => dirname(__DIR__) . '/kit',
        ];
        return $sources;
    }

    /** @param array<string,array<string,mixed>> $apps @return array<string,array<string,mixed>> */
    public function builder_apps(array $apps): array {
        $apps['kodefy'] = [
            'capability' => 'manage_options',
            'extension' => SLUG,
            'shared' => false,
        ];
        return $apps;
    }

    /** @param array<string,mixed> $config @param array<string,mixed> $context @return array<string,mixed> */
    public function editor_shell_config(array $config, array $context): array {
        if (!empty($context['isShared']) || empty($context['canManageIntegrations'])) return $config;
        $surface_url = $context['surfaceUrl'] ?? null;
        $config['kodefyUrl'] = add_query_arg(
            'section',
            'mcp',
            is_callable($surface_url)
                ? (string) $surface_url('settings')
                : home_url('/kodety/settings/')
        );
        $config['kodefySettingsUrl'] = rest_url('kodefy/v1/settings');
        $config['kodefyConnectionTestUrl'] = rest_url('kodefy/v1/connection-test');
        $config['kodefyBuilderDataUrl'] = rest_url('kodefy/v1/builder-data');
        $config['kodefyDownloadKitUrl'] = wp_nonce_url(
            admin_url('admin-post.php?action=kodefy_download_kit'),
            'kodefy_download_kit'
        );
        return $config;
    }

    public function admin_menu(): void {
        $i18n = class_exists('\Kodety_Admin_I18n') ? \Kodety_Admin_I18n::instance() : null;
        $title = $i18n ? $i18n->translate('Kodefy Shopify') : 'Kodefy Shopify';
        add_submenu_page(
            'kodety',
            $title,
            $title,
            'manage_options',
            'kodefy-shopify',
            [$this, 'admin_page']
        );
    }

    public function admin_assets(string $hook): void {
        if (!str_contains($hook, 'kodefy-shopify')) return;
        wp_enqueue_style(
            'kodefy-admin',
            rest_url('kodefy/v1/asset/kodefy-admin.css'),
            [],
            VERSION
        );
    }

    public function runtime_assets(): void {
        if (is_admin()) return;
        wp_enqueue_style(
            'kodefy-components',
            rest_url('kodefy/v1/asset/kodefy-components.css'),
            [],
            VERSION
        );
        wp_enqueue_script(
            'kodefy-runtime',
            rest_url('kodefy/v1/asset/kodefy-runtime.js'),
            [],
            VERSION,
            true
        );
    }

    public function runtime_config(): void {
        if (is_admin()) return;
        $settings = $this->settings();
        $domain = (new Kodefy_Shopify($settings))->domain();
        $routes = is_array($settings['routes'] ?? null) ? $settings['routes'] : [];
        $templates = is_array($settings['templates'] ?? null) ? $settings['templates'] : [];
        $checkout = $this->checkout_settings($settings);
        $config = [
            'version' => VERSION,
            'configured' => $domain !== '' && Kodefy_Crypto::decrypt((string) ($settings['storefrontToken'] ?? '')) !== '',
            'restUrl' => untrailingslashit(rest_url('kodefy/v1')),
            'shopDomain' => $domain,
            'accountUrl' => $domain !== '' ? 'https://' . $domain . '/account' : '',
            'routes' => [
                'shop' => $this->route($routes['shop'] ?? '/shop/'),
                'product' => $this->route($routes['product'] ?? '/products/'),
                'collection' => $this->route($routes['collection'] ?? '/collections/'),
                'cart' => $this->route($routes['cart'] ?? '/cart/'),
                'search' => $this->route($routes['search'] ?? '/search/'),
                'wishlist' => $this->route($routes['wishlist'] ?? '/wishlist/'),
            ],
            'templates' => [
                'product' => $this->template_route($templates['product'] ?? 'product', 'product'),
                'collection' => $this->template_route($templates['collection'] ?? 'collection', 'collection'),
            ],
            'checkout' => [
                'provider' => $checkout['provider'],
                'strategy' => $checkout['strategy'],
                'experience' => $checkout['experience'],
                'fallbackToShopify' => $checkout['fallbackToShopify'],
                'openInNewTab' => $checkout['openInNewTab'],
                'overlaySelector' => $checkout['overlaySelector'],
                'returnUrl' => home_url($checkout['returnPath']),
                'cancelUrl' => home_url($checkout['cancelPath']),
            ],
        ];
        echo '<script type="application/json" id="kodefy-config">'
            . wp_json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT)
            . '</script>';
    }

    /**
     * Product and collection handles are virtual storefront routes. The
     * published Kodety workspace owns one editable template for each type.
     *
     * @param array<string,mixed> $context
     * @return array<string,mixed>
     */
    public function dynamic_runtime_routes(array $context): array {
        $match = $this->captured_dynamic_route();
        if ($match === null) {
            $request_route = isset($context['route'])
                ? trim((string) $context['route'], '/')
                : $this->request_route();
            $match = $this->match_dynamic_route($request_route);
        }
        if ($match !== null) {
            $context['route'] = $match['template'];
            $context['kodefy'] = [
                'kind' => $match['kind'],
                'handle' => $match['handle'],
                'requestRoute' => $match['requestRoute'],
                'template' => $match['template'],
            ];
        }
        return $context;
    }

    /** @param string[] $vars @return string[] */
    public function dynamic_query_vars(array $vars): array {
        return array_values(array_unique(array_merge($vars, [
            'kodefy_dynamic_kind',
            'kodefy_dynamic_handle',
            'kodefy_dynamic_template',
            'kodefy_dynamic_request',
        ])));
    }

    /** Capture virtual Shopify URLs before WordPress commits to a 404. */
    public function detect_dynamic_route(\WP $wp): void {
        $request_route = isset($wp->query_vars['kodety_agency_route'])
            ? trim((string) $wp->query_vars['kodety_agency_route'], '/')
            : $this->request_route();
        $match = $this->match_dynamic_route($request_route);
        if ($match === null) return;
        $wp->query_vars['kodefy_dynamic_kind'] = $match['kind'];
        $wp->query_vars['kodefy_dynamic_handle'] = $match['handle'];
        $wp->query_vars['kodefy_dynamic_template'] = $match['template'];
        $wp->query_vars['kodefy_dynamic_request'] = $match['requestRoute'];
        $wp->query_vars['post_type'] = $match['kind'] === 'product'
            ? self::PRODUCT_POST_TYPE
            : self::COLLECTION_POST_TYPE;
        $wp->query_vars['name'] = $match['handle'];
        if (!empty($wp->query_vars['kodety_agency_site'])) {
            $wp->query_vars['kodety_agency_route'] = $match['template'];
        }
    }

    public function disable_dynamic_canonical_redirect(mixed $redirect, string $requested = ''): mixed {
        return (string) get_query_var('kodefy_dynamic_handle') !== '' ? false : $redirect;
    }

    /** Keep synchronized Shopify entries on the configured virtual storefront route. */
    public function managed_post_permalink(string $permalink, \WP_Post $post): string {
        $kind = match ($post->post_type) {
            self::PRODUCT_POST_TYPE => 'product',
            self::COLLECTION_POST_TYPE => 'collection',
            default => '',
        };
        if ($kind === '') return $permalink;
        $settings = $this->settings();
        $routes = is_array($settings['routes'] ?? null) ? $settings['routes'] : [];
        $base = $this->route($routes[$kind] ?? ($kind === 'product' ? '/products/' : '/collections/'));
        $handle = sanitize_title($post->post_name ?: (string) $post->ID);
        return home_url(user_trailingslashit(trim($base . $handle, '/')));
    }

    /** Put mirrored Shopify content in the initial HTML response. */
    public function render_managed_seo_html(mixed $html, mixed $context): string {
        if (!is_string($html) || $html === '' || !class_exists('\\DOMDocument')) return is_string($html) ? $html : '';
        $post = get_queried_object();
        $managed_post = $post instanceof \WP_Post
            && in_array($post->post_type, [self::PRODUCT_POST_TYPE, self::COLLECTION_POST_TYPE], true);
        $has_catalog = str_contains($html, 'data-kodefy-products')
            || str_contains($html, 'data-kodefy-collection-products');
        if (!$managed_post && !$has_catalog) return $html;
        $document = new \DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);
        $loaded = $document->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        if (!$loaded) return $html;
        $xpath = new \DOMXPath($document);
        $this->render_managed_product_lists($document, $xpath, $managed_post ? $post : null);
        if (!$managed_post) return $this->serialized_document($document, $html);
        $is_product = $post->post_type === self::PRODUCT_POST_TYPE;
        $prefix = $is_product ? 'product' : 'collection';
        $root = $xpath->query($is_product
            ? '//*[@data-kodefy-product-detail]'
            : '//*[@data-kodefy-collection]')->item(0);
        if (!$root instanceof \DOMElement) $root = $document->documentElement;
        if ($root instanceof \DOMElement) {
            $root->setAttribute('data-handle', sanitize_title($post->post_name));
            $root->setAttribute('data-kodefy-' . $prefix . '-handle', sanitize_title($post->post_name));
        }
        $title = get_the_title($post);
        $description_html = (string) get_post_meta($post->ID, 'description_html', true);
        $description = trim(wp_strip_all_tags($description_html ?: $post->post_excerpt));
        $seo_title = trim((string) get_post_meta($post->ID, 'seo_title', true)) ?: $title;
        $seo_description = trim((string) get_post_meta($post->ID, 'seo_description', true)) ?: $description;
        $image = get_post_meta($post->ID, 'featured_image', true);
        $image = is_array($image) ? $image : ['url' => (string) $image, 'alt' => ''];
        $this->set_marker_text($xpath, $root, 'data-kodefy-' . $prefix . '-title', $title);
        $this->set_marker_text($xpath, $root, 'data-kodefy-' . $prefix . '-description', $description);
        $this->set_marker_image($xpath, $root, (string) ($image['url'] ?? ''), (string) ($image['alt'] ?? $title));
        if ($is_product) {
            $this->set_marker_text($xpath, $root, 'data-kodefy-product-vendor', (string) get_post_meta($post->ID, 'vendor', true));
            $this->set_marker_text($xpath, $root, 'data-kodefy-product-price', $this->formatted_product_price($post->ID, 'price'));
            $this->set_marker_text($xpath, $root, 'data-kodefy-product-compare-price', $this->formatted_product_price($post->ID, 'compare_at_price'));
            if ($this->render_product_detail_controls($document, $xpath, $root, $post)) {
                $root->setAttribute('data-kodefy-ready', 'true');
                $root->setAttribute('data-kodefy-server-ready', 'true');
            }
        } elseif ($root instanceof \DOMElement && $root->getAttribute('data-kodefy-ready') === '') {
            $products_root = $xpath->query('.//*[@data-kodefy-collection-products]', $root)->item(0);
            if ($products_root instanceof \DOMElement && $products_root->getAttribute('data-kodefy-ready') === 'true') {
                $root->setAttribute('data-kodefy-ready', 'true');
            }
        }
        foreach ($xpath->query('//title') ?: [] as $node) $node->textContent = $seo_title;
        $head = $xpath->query('//head')->item(0);
        if ($head instanceof \DOMElement) {
            $this->set_head_meta($document, $xpath, $head, 'name', 'description', $seo_description);
            $this->set_head_meta($document, $xpath, $head, 'property', 'og:title', $seo_title);
            $this->set_head_meta($document, $xpath, $head, 'property', 'og:description', $seo_description);
            if (!empty($image['url'])) $this->set_head_meta($document, $xpath, $head, 'property', 'og:image', esc_url_raw((string) $image['url']));
            if ($is_product) {
                $schema = $document->createElement('script');
                $schema->setAttribute('type', 'application/ld+json');
                $schema->appendChild($document->createTextNode((string) wp_json_encode([
                    '@context' => 'https://schema.org',
                    '@type' => 'Product',
                    'name' => $title,
                    'description' => $seo_description,
                    'image' => !empty($image['url']) ? [(string) $image['url']] : [],
                    'sku' => $this->first_product_sku($post->ID),
                    'brand' => ['@type' => 'Brand', 'name' => (string) get_post_meta($post->ID, 'vendor', true)],
                    'offers' => [
                        '@type' => 'Offer',
                        'url' => get_permalink($post),
                        'priceCurrency' => (string) get_post_meta($post->ID, 'currency', true),
                        'price' => (string) get_post_meta($post->ID, 'price', true),
                        'availability' => get_post_meta($post->ID, 'available', true) === '1'
                            ? 'https://schema.org/InStock'
                            : 'https://schema.org/OutOfStock',
                    ],
                ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)));
                $head->appendChild($schema);
            }
        }
        return $this->serialized_document($document, $html);
    }

    private function serialized_document(\DOMDocument $document, string $fallback): string {
        $rendered = $document->saveHTML();
        return is_string($rendered) && $rendered !== ''
            ? (string) preg_replace('/^<\?xml[^>]*>\s*/', '', $rendered)
            : $fallback;
    }

    private function render_managed_product_lists(\DOMDocument $document, \DOMXPath $xpath, ?\WP_Post $queried): void {
        $collection_roots = [];
        foreach ($xpath->query('//*[@data-kodefy-collection-products]') ?: [] as $root) {
            if ($root instanceof \DOMElement) $collection_roots[] = $root;
        }
        if ($collection_roots && $queried instanceof \WP_Post && $queried->post_type === self::COLLECTION_POST_TYPE) {
            $handles = json_decode((string) get_post_meta($queried->ID, 'product_handles_json', true), true);
            $handles = is_array($handles) ? array_values(array_filter(array_map('sanitize_title', $handles))) : [];
            $posts = $handles ? get_posts([
                'post_type' => self::PRODUCT_POST_TYPE,
                'post_status' => 'publish',
                'posts_per_page' => min(50, count($handles)),
                'post_name__in' => $handles,
                'no_found_rows' => true,
            ]) : [];
            $by_handle = [];
            foreach ($posts as $product) {
                if ($product instanceof \WP_Post) $by_handle[$product->post_name] = $product;
            }
            $ordered = [];
            foreach ($handles as $handle) if (isset($by_handle[$handle])) $ordered[] = $by_handle[$handle];
            foreach ($collection_roots as $root) $this->render_product_card_list($document, $xpath, $root, $ordered);
        }

        foreach ($xpath->query('//*[@data-kodefy-products]') ?: [] as $root) {
            if (!$root instanceof \DOMElement) continue;
            $limit = max(1, min(50, (int) ($root->getAttribute('data-limit') ?: 12)));
            $args = [
                'post_type' => self::PRODUCT_POST_TYPE,
                'post_status' => 'publish',
                'posts_per_page' => $limit,
                'orderby' => 'modified',
                'order' => 'DESC',
                'no_found_rows' => true,
            ];
            if ($queried instanceof \WP_Post && $queried->post_type === self::PRODUCT_POST_TYPE) {
                $args['post__not_in'] = [$queried->ID];
            }
            $products = array_values(array_filter(get_posts($args), static fn(mixed $item): bool => $item instanceof \WP_Post));
            $this->render_product_card_list($document, $xpath, $root, $products);
        }
    }

    /** @param array<int,\WP_Post> $products */
    private function render_product_card_list(\DOMDocument $document, \DOMXPath $xpath, \DOMElement $root, array $products): void {
        $template = $xpath->query('.//*[@data-kodefy-product-card]', $root)->item(0);
        if (!$template instanceof \DOMElement) return;
        while ($root->firstChild) $root->removeChild($root->firstChild);
        if (!$products) {
            $empty = $document->createElement('p');
            $empty->setAttribute('class', 'kodefy-empty');
            $empty->appendChild($document->createTextNode(
                $root->getAttribute('data-empty-message') ?: 'Nenhum produto encontrado.'
            ));
            $root->appendChild($empty);
            $root->setAttribute('data-kodefy-ready', 'true');
            return;
        }
        foreach ($products as $product) {
            $card = $template->cloneNode(true);
            if (!$card instanceof \DOMElement) continue;
            $this->bind_managed_product_card($xpath, $card, $product);
            $root->appendChild($card);
        }
        $root->setAttribute('data-kodefy-ready', 'true');
    }

    private function bind_managed_product_card(\DOMXPath $xpath, \DOMElement $card, \WP_Post $product): void {
        $card->removeAttribute('data-kodefy-template');
        $handle = sanitize_title($product->post_name);
        $url = $this->managed_post_permalink('', $product);
        $card->setAttribute('data-kodefy-product-handle', $handle);
        $card->setAttribute('data-kodefy-product-url', esc_url_raw($url));
        $this->set_marker_text($xpath, $card, 'data-kodefy-product-title', get_the_title($product));
        $this->set_marker_text($xpath, $card, 'data-kodefy-product-vendor', (string) get_post_meta($product->ID, 'vendor', true));
        $this->set_marker_text($xpath, $card, 'data-kodefy-product-price', $this->formatted_product_price($product->ID, 'price'));
        foreach ($xpath->query('.//*[@data-kodefy-product-link]', $card) ?: [] as $link) {
            if ($link instanceof \DOMElement) $link->setAttribute('href', esc_url_raw($url));
        }
        $image = get_post_meta($product->ID, 'featured_image', true);
        $image = is_array($image) ? $image : ['url' => (string) $image, 'alt' => ''];
        foreach ($xpath->query('.//*[@data-kodefy-product-image]', $card) ?: [] as $node) {
            if (!$node instanceof \DOMElement || empty($image['url'])) continue;
            $node->setAttribute('src', esc_url_raw((string) $image['url']));
            $node->setAttribute('alt', sanitize_text_field((string) ($image['alt'] ?? get_the_title($product))));
        }
        $variant = $this->first_available_product_variant($product->ID);
        foreach ($xpath->query('.//*[@data-kodefy-add]', $card) ?: [] as $button) {
            if (!$button instanceof \DOMElement) continue;
            $button->setAttribute('data-product-handle', $handle);
            $button->setAttribute('data-variant-id', sanitize_text_field((string) ($variant['id'] ?? '')));
            if (empty($variant['availableForSale'])) {
                $button->setAttribute('disabled', 'disabled');
                $button->textContent = 'Indisponível';
            }
        }
        foreach ($xpath->query('.//*[@data-kodefy-wishlist-toggle]', $card) ?: [] as $button) {
            if ($button instanceof \DOMElement) $button->setAttribute('data-product-handle', $handle);
        }
    }

    private function render_product_detail_controls(\DOMDocument $document, \DOMXPath $xpath, \DOMNode $root, \WP_Post $post): bool {
        $variants = $this->product_variants($post->ID);
        if (!$variants) return false;
        $initial = null;
        foreach ($variants as $variant) {
            if (!empty($variant['availableForSale'])) { $initial = $variant; break; }
        }
        if (!is_array($initial)) $initial = $variants[0];
        $select = $xpath->query('.//*[@data-kodefy-variant]', $root)->item(0);
        if ($select instanceof \DOMElement) {
            while ($select->firstChild) $select->removeChild($select->firstChild);
            foreach ($variants as $variant) {
                $option = $document->createElement('option');
                $id = sanitize_text_field((string) ($variant['id'] ?? ''));
                $available = !empty($variant['availableForSale']);
                $option->setAttribute('value', $id);
                $option->setAttribute('data-variant-price', $this->formatted_money($variant['price'] ?? null));
                $option->setAttribute('data-variant-compare-price', $this->formatted_money($variant['compareAtPrice'] ?? null, true));
                $option->setAttribute('data-variant-available', $available ? '1' : '0');
                if (isset($variant['quantityAvailable']) && is_numeric($variant['quantityAvailable'])) {
                    $option->setAttribute('data-variant-quantity', (string) (int) $variant['quantityAvailable']);
                }
                if (is_array($variant['image'] ?? null) && !empty($variant['image']['url'])) {
                    $option->setAttribute('data-variant-image', esc_url_raw((string) $variant['image']['url']));
                    $option->setAttribute('data-variant-image-alt', sanitize_text_field((string) ($variant['image']['altText'] ?? get_the_title($post))));
                }
                if (!$available) $option->setAttribute('disabled', 'disabled');
                if ($id !== '' && hash_equals((string) ($initial['id'] ?? ''), $id)) $option->setAttribute('selected', 'selected');
                $label = sanitize_text_field((string) ($variant['title'] ?? 'Opção'));
                $price = $this->formatted_money($variant['price'] ?? null);
                $option->appendChild($document->createTextNode(trim($label . ($price !== '' ? ' — ' . $price : '') . (!$available ? ' · Indisponível' : ''))));
                $select->appendChild($option);
            }
        }
        $id = sanitize_text_field((string) ($initial['id'] ?? ''));
        foreach ($xpath->query('.//*[@data-kodefy-add]', $root) ?: [] as $button) {
            if (!$button instanceof \DOMElement) continue;
            $label = trim((string) $button->textContent);
            if ($label !== '' && !$button->hasAttribute('data-label')) {
                $button->setAttribute('data-label', sanitize_text_field($label));
            }
            $button->setAttribute('data-variant-id', $id);
            $button->setAttribute('data-product-handle', sanitize_title($post->post_name));
            if (empty($initial['availableForSale'])) {
                $button->setAttribute('disabled', 'disabled');
                $button->textContent = 'Indisponível';
            } else {
                $button->removeAttribute('disabled');
            }
        }
        $this->set_marker_text($xpath, $root, 'data-kodefy-product-price', $this->formatted_money($initial['price'] ?? null));
        $compare_price = $this->formatted_money($initial['compareAtPrice'] ?? null, true);
        foreach ($xpath->query('.//*[@data-kodefy-product-compare-price]', $root) ?: [] as $compare) {
            if (!$compare instanceof \DOMElement) continue;
            $compare->textContent = $compare_price;
            if ($compare_price === '') $compare->setAttribute('hidden', 'hidden');
            else $compare->removeAttribute('hidden');
        }
        $inventory = $xpath->query('.//*[@data-kodefy-inventory]', $root)->item(0);
        if ($inventory instanceof \DOMElement) {
            $available = !empty($initial['availableForSale']);
            $quantity = isset($initial['quantityAvailable']) && is_numeric($initial['quantityAvailable'])
                ? (int) $initial['quantityAvailable']
                : null;
            $inventory->textContent = !$available
                ? 'Sem estoque'
                : ($quantity !== null && $quantity <= 5 ? 'Últimas ' . $quantity . ' unidades' : 'Em estoque');
        }
        $this->render_product_gallery($document, $xpath, $root, $post);
        return $id !== '';
    }

    private function render_product_gallery(\DOMDocument $document, \DOMXPath $xpath, \DOMNode $root, \WP_Post $post): void {
        $images = json_decode((string) get_post_meta($post->ID, 'images_json', true), true);
        if (!is_array($images)) return;
        $thumbs = $xpath->query('.//*[@data-kodefy-gallery-thumbs]', $root)->item(0);
        if (!$thumbs instanceof \DOMElement) return;
        while ($thumbs->firstChild) $thumbs->removeChild($thumbs->firstChild);
        foreach (array_values($images) as $index => $image) {
            if (!is_array($image) || empty($image['url'])) continue;
            $button = $document->createElement('button');
            $button->setAttribute('type', 'button');
            $button->setAttribute('data-kodefy-gallery-thumb', esc_url_raw((string) $image['url']));
            $button->setAttribute('data-alt', sanitize_text_field((string) ($image['altText'] ?? get_the_title($post))));
            $button->setAttribute('aria-label', 'Ver imagem ' . ((int) $index + 1));
            $thumbnail = $document->createElement('img');
            $thumbnail->setAttribute('src', esc_url_raw((string) $image['url']));
            $thumbnail->setAttribute('alt', '');
            $thumbnail->setAttribute('loading', 'lazy');
            $button->appendChild($thumbnail);
            $thumbs->appendChild($button);
        }
    }

    private function set_marker_text(\DOMXPath $xpath, \DOMNode $root, string $attribute, string $value): void {
        if ($value === '') return;
        foreach ($xpath->query('.//*[@' . $attribute . ']', $root) ?: [] as $node) $node->textContent = $value;
    }

    private function set_marker_image(\DOMXPath $xpath, \DOMNode $root, string $url, string $alt): void {
        if ($url === '') return;
        foreach ($xpath->query('.//*[@data-kodefy-gallery-main or @data-kodefy-collection-image]', $root) ?: [] as $node) {
            if (!$node instanceof \DOMElement) continue;
            $node->setAttribute('src', esc_url_raw($url));
            $node->setAttribute('alt', sanitize_text_field($alt));
        }
    }

    private function set_head_meta(\DOMDocument $document, \DOMXPath $xpath, \DOMElement $head, string $attribute, string $key, string $content): void {
        if ($content === '') return;
        $node = $xpath->query('//meta[@' . $attribute . '="' . $key . '"]')->item(0);
        if (!$node instanceof \DOMElement) {
            $node = $document->createElement('meta');
            $node->setAttribute($attribute, $key);
            $head->appendChild($node);
        }
        $node->setAttribute('content', $content);
    }

    private function formatted_product_price(int $post_id, string $key): string {
        $amount = (string) get_post_meta($post_id, $key, true);
        if ($amount === '' || !is_numeric($amount)) return '';
        $currency = (string) get_post_meta($post_id, 'currency', true);
        $symbol = $currency === 'BRL' ? 'R$' : $currency;
        return trim($symbol . ' ' . number_format((float) $amount, 2, ',', '.'));
    }

    private function formatted_money(mixed $money, bool $hide_zero = false): string {
        if (!is_array($money) || !is_numeric($money['amount'] ?? null)) return '';
        $amount = (float) $money['amount'];
        if ($hide_zero && $amount <= 0) return '';
        $currency = sanitize_text_field((string) ($money['currencyCode'] ?? ''));
        $symbol = $currency === 'BRL' ? 'R$' : $currency;
        return trim($symbol . ' ' . number_format($amount, 2, ',', '.'));
    }

    private function first_product_sku(int $post_id): string {
        $variant = $this->first_available_product_variant($post_id);
        return is_array($variant)
            ? sanitize_text_field((string) ($variant['sku'] ?? ''))
            : '';
    }

    /** @return array<string,mixed>|null */
    private function first_available_product_variant(int $post_id): ?array {
        $variants = $this->product_variants($post_id);
        foreach ($variants as $variant) {
            if (is_array($variant) && !empty($variant['availableForSale'])) return $variant;
        }
        return is_array($variants[0] ?? null) ? $variants[0] : null;
    }

    /** @return array<int,array<string,mixed>> */
    private function product_variants(int $post_id): array {
        $decoded = json_decode((string) get_post_meta($post_id, 'variants_json', true), true);
        $variants = is_array($decoded)
            ? array_values(array_filter($decoded, 'is_array'))
            : [];
        if ($variants) return $variants;
        $variant_id = sanitize_text_field((string) get_post_meta($post_id, 'variant_id', true));
        if ($variant_id === '') return [];
        return [[
            'id' => $variant_id,
            'title' => 'Opção padrão',
            'availableForSale' => get_post_meta($post_id, 'variant_available', true) === '1',
            'quantityAvailable' => get_post_meta($post_id, 'variant_quantity', true),
            'price' => [
                'amount' => (string) get_post_meta($post_id, 'price', true),
                'currencyCode' => (string) get_post_meta($post_id, 'currency', true),
            ],
        ]];
    }

    public function rest_routes(): void {
        (new Kodefy_Storefront($this))->register_routes();
        register_rest_route('kodefy/v1', '/settings', [
            [
                'methods' => \WP_REST_Server::READABLE,
                'permission_callback' => static fn(): bool => current_user_can('manage_options'),
                'callback' => [$this, 'rest_settings'],
            ],
            [
                'methods' => \WP_REST_Server::EDITABLE,
                'permission_callback' => static fn(): bool => current_user_can('manage_options'),
                'callback' => [$this, 'rest_settings'],
            ],
        ]);
        register_rest_route('kodefy/v1', '/connection-test', [
            'methods' => \WP_REST_Server::CREATABLE,
            'permission_callback' => static fn(): bool => current_user_can('manage_options'),
            'callback' => [$this, 'rest_connection_test'],
        ]);
        register_rest_route('kodefy/v1', '/builder-data', [
            [
                'methods' => \WP_REST_Server::READABLE,
                'permission_callback' => static fn(): bool => current_user_can('manage_options'),
                'callback' => [$this, 'rest_builder_data'],
            ],
            [
                'methods' => \WP_REST_Server::CREATABLE,
                'permission_callback' => static fn(): bool => current_user_can('manage_options'),
                'callback' => [$this, 'rest_builder_data'],
            ],
        ]);
        register_rest_route('kodefy/v1', '/asset/(?P<file>kodefy-(?:runtime\.js|components\.css|admin\.css))', [
            'methods' => \WP_REST_Server::READABLE,
            'permission_callback' => '__return_true',
            'callback' => [$this, 'serve_asset'],
        ]);
    }

    public function serve_asset(\WP_REST_Request $request): void {
        $file = (string) $request['file'];
        $allowed = [
            'kodefy-runtime.js' => 'application/javascript; charset=UTF-8',
            'kodefy-components.css' => 'text/css; charset=UTF-8',
            'kodefy-admin.css' => 'text/css; charset=UTF-8',
        ];
        $path = __DIR__ . '/../assets/' . $file;
        if (!isset($allowed[$file]) || !is_file($path)) {
            status_header(404);
            exit;
        }
        $etag = '"' . md5_file($path) . '"';
        if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
            status_header(304);
            exit;
        }
        while (ob_get_level() > 0) ob_end_clean();
        header('Content-Type: ' . $allowed[$file]);
        header('Cache-Control: public, max-age=31536000, immutable');
        header('ETag: ' . $etag);
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    public function rest_settings(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        if ($request->get_method() === 'GET') {
            $settings = $this->settings();
            $checkout = $this->checkout_settings($settings);
            return new \WP_REST_Response([
                'schemaVersion' => 2,
                'shopDomain' => (string) ($settings['shopDomain'] ?? ''),
                'storefrontTokenType' => (string) ($settings['storefrontTokenType'] ?? 'public'),
                'hasStorefrontToken' => Kodefy_Crypto::decrypt((string) ($settings['storefrontToken'] ?? '')) !== '',
                'country' => (string) ($settings['country'] ?? 'BR'),
                'language' => (string) ($settings['language'] ?? 'PT'),
                'routes' => is_array($settings['routes'] ?? null) ? $settings['routes'] : [],
                'templates' => is_array($settings['templates'] ?? null) ? $settings['templates'] : [
                    'product' => 'product',
                    'collection' => 'collection',
                ],
                'checkout' => [
                    'provider' => $checkout['provider'],
                    'strategy' => $checkout['strategy'],
                    'experience' => $checkout['experience'],
                    'endpointUrl' => $checkout['endpointUrl'],
                    'linkTemplate' => $checkout['linkTemplate'],
                    'allowedHosts' => $checkout['allowedHosts'],
                    'fallbackToShopify' => $checkout['fallbackToShopify'],
                    'openInNewTab' => $checkout['openInNewTab'],
                    'overlaySelector' => $checkout['overlaySelector'],
                    'returnPath' => $checkout['returnPath'],
                    'cancelPath' => $checkout['cancelPath'],
                    'hasEndpointSecret' => Kodefy_Crypto::decrypt((string) $checkout['endpointSecret']) !== '',
                ],
                'apiVersion' => API_VERSION,
            ]);
        }
        $params = $request->get_json_params();
        if (!is_array($params)) $params = $request->get_params();
        try {
            $settings = $this->persist_settings($params);
            $snapshot = $this->sync_builder_data(true);
            $sync = is_wp_error($snapshot)
                ? [
                    'configured' => (new Kodefy_Shopify($settings))->configured(),
                    'error' => $snapshot->get_error_message(),
                ]
                : $this->snapshot_summary($snapshot);
            return new \WP_REST_Response([
                'success' => true,
                'message' => 'Configuração do Kodefy salva.',
                'hasStorefrontToken' => Kodefy_Crypto::decrypt((string) ($settings['storefrontToken'] ?? '')) !== '',
                'sync' => $sync,
            ]);
        } catch (\Throwable $error) {
            return new \WP_Error('kodefy_settings_invalid', $error->getMessage(), ['status' => 400]);
        }
    }

    public function rest_connection_test(): \WP_REST_Response|\WP_Error {
        $result = (new Kodefy_Shopify($this->settings()))->verify_storefront();
        if (is_wp_error($result)) return $result;
        $shop = is_array($result['shop'] ?? null) ? $result['shop'] : [];
        return new \WP_REST_Response([
            'success' => true,
            'shop' => sanitize_text_field((string) ($shop['name'] ?? 'Shopify')),
            'currency' => sanitize_text_field((string) ($shop['paymentSettings']['currencyCode'] ?? '')),
        ]);
    }

    public function rest_builder_data(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $force = $request->get_method() !== 'GET'
            || rest_sanitize_boolean($request->get_param('refresh'));
        $snapshot = $this->sync_builder_data($force);
        if (is_wp_error($snapshot)) return $snapshot;
        $response = new \WP_REST_Response($snapshot);
        $response->header('Cache-Control', 'private, no-store, max-age=0');
        return $response;
    }

    public function save_settings(): void {
        $this->assert_admin('kodefy_save_settings');
        try {
            $this->persist_settings(wp_unslash($_POST));
            $snapshot = $this->sync_builder_data(true);
            if (is_wp_error($snapshot)) {
                $this->redirect_notice('error', 'Configuração salva, mas o catálogo não foi sincronizado: ' . $snapshot->get_error_message());
            }
        } catch (\Throwable $error) {
            $this->redirect_notice('error', $error->getMessage());
        }
        $this->redirect_notice('success', 'Configuração do Kodefy salva.');
    }

    public function test_connection(): void {
        $this->assert_admin('kodefy_test_connection');
        $result = (new Kodefy_Shopify($this->settings()))->verify_storefront();
        if (is_wp_error($result)) $this->redirect_notice('error', $result->get_error_message());
        $shop = is_array($result['shop'] ?? null) ? $result['shop'] : [];
        $name = sanitize_text_field((string) ($shop['name'] ?? 'Shopify'));
        $currency = sanitize_text_field((string) ($shop['paymentSettings']['currencyCode'] ?? ''));
        $this->redirect_notice('success', 'Conexão confirmada com ' . $name . ($currency !== '' ? ' (' . $currency . ')' : '') . '.');
    }

    public function download_kit(): void {
        $this->assert_admin('kodefy_download_kit');
        try {
            $this->send_zip($this->exporter()->kit_zip(), 'kodefy-kodety-kit.zip');
        } catch (\Throwable $error) {
            $this->redirect_notice('error', $error->getMessage());
        }
    }

    public function admin_page(): void {
        if (!current_user_can('manage_options')) wp_die('Sem permissão.', '', ['response' => 403]);
        $i18n = class_exists('\Kodety_Admin_I18n') ? \Kodety_Admin_I18n::instance() : null;
        $translate = static fn(string $source): string => $i18n ? $i18n->translate($source) : $source;
        $settings = $this->settings();
        $routes = is_array($settings['routes'] ?? null) ? $settings['routes'] : [];
        $templates = is_array($settings['templates'] ?? null) ? $settings['templates'] : [];
        $has_storefront = Kodefy_Crypto::decrypt((string) ($settings['storefrontToken'] ?? '')) !== '';
        $notice_key = 'kodefy_notice_' . get_current_user_id();
        $notice = get_transient($notice_key);
        delete_transient($notice_key);
        ?>
        <div class="wrap kodefy-admin">
            <header class="kodefy-admin__hero">
                <div>
                    <span class="kodefy-admin__eyebrow"><?php echo esc_html($translate('KODETY × SHOPIFY')); ?></span>
                    <h1><?php echo esc_html($translate('Kodefy Commerce')); ?></h1>
                    <p><?php echo esc_html($translate('Desenhe a loja no Kodety e use a Shopify como catálogo, estoque, carrinho, checkout e operação de pedidos.')); ?></p>
                </div>
                <span class="kodefy-admin__status <?php echo $has_storefront ? 'is-connected' : ''; ?>">
                    <?php echo esc_html($translate($has_storefront ? 'Storefront conectado' : 'Configuração pendente')); ?>
                </span>
            </header>
            <?php if (is_array($notice)): ?>
                <div class="notice notice-<?php echo esc_attr(($notice['type'] ?? '') === 'success' ? 'success' : 'error'); ?> is-dismissible"><p><?php echo esc_html($translate((string) ($notice['message'] ?? ''))); ?></p></div>
            <?php endif; ?>
            <div class="kodefy-admin__grid">
                <main class="kodefy-card">
                    <h2><?php echo esc_html($translate('Conectar a Shopify')); ?></h2>
                    <p class="description"><?php echo esc_html($translate('Crie uma storefront no canal Headless da Shopify e informe o domínio permanente e um token da Storefront API.')); ?></p>
                    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                        <input type="hidden" name="action" value="kodefy_save_settings">
                        <?php wp_nonce_field('kodefy_save_settings'); ?>
                        <div class="kodefy-fields">
                            <label><span><?php echo esc_html($translate('Domínio myshopify.com')); ?></span><input name="shop_domain" type="text" value="<?php echo esc_attr((string) ($settings['shopDomain'] ?? '')); ?>" placeholder="minha-loja.myshopify.com" autocomplete="off"></label>
                            <label><span><?php echo esc_html($translate('Tipo do token Storefront')); ?></span><select name="storefront_token_type"><option value="public" <?php selected(($settings['storefrontTokenType'] ?? 'public'), 'public'); ?>><?php echo esc_html($translate('Público')); ?></option><option value="private" <?php selected(($settings['storefrontTokenType'] ?? ''), 'private'); ?>><?php echo esc_html($translate('Privado (proxy WordPress)')); ?></option></select></label>
                            <label class="kodefy-field--wide"><span><?php echo esc_html($translate($has_storefront ? 'Storefront API token (já salvo)' : 'Storefront API token')); ?></span><input name="storefront_token" type="password" value="" autocomplete="new-password" placeholder="<?php echo esc_attr($translate('Deixe vazio para preservar o atual')); ?>"></label>
                            <?php if ($has_storefront): ?><label class="kodefy-check"><input type="checkbox" name="clear_storefront_token" value="1"><span><?php echo esc_html($translate('Remover token Storefront salvo')); ?></span></label><?php endif; ?>
                            <label><span><?php echo esc_html($translate('País (ISO)')); ?></span><input name="country" type="text" maxlength="2" value="<?php echo esc_attr((string) ($settings['country'] ?? 'BR')); ?>"></label>
                            <label><span><?php echo esc_html($translate('Idioma (ISO)')); ?></span><input name="language" type="text" maxlength="2" value="<?php echo esc_attr((string) ($settings['language'] ?? 'PT')); ?>"></label>
                        </div>
                        <h3><?php echo esc_html($translate('Rotas no WordPress')); ?></h3>
                        <div class="kodefy-fields kodefy-fields--routes">
                            <?php foreach (['shop' => 'Loja', 'product' => 'Produto', 'collection' => 'Coleção', 'cart' => 'Carrinho', 'search' => 'Busca', 'wishlist' => 'Favoritos'] as $key => $label): ?>
                                <label><span><?php echo esc_html($translate($label)); ?></span><input name="route_<?php echo esc_attr($key); ?>" type="text" value="<?php echo esc_attr((string) ($routes[$key] ?? '/' . $key . '/')); ?>"></label>
                            <?php endforeach; ?>
                        </div>
                        <h3><?php echo esc_html($translate('Templates dinâmicos')); ?></h3>
                        <p class="description"><?php echo esc_html($translate('Informe a rota da página criada no Builder que será usada para cada item dinâmico.')); ?></p>
                        <div class="kodefy-fields kodefy-fields--routes">
                            <label><span><?php echo esc_html($translate('Produto')); ?></span><input name="template_product" type="text" value="<?php echo esc_attr((string) ($templates['product'] ?? 'product')); ?>" placeholder="product"></label>
                            <label><span><?php echo esc_html($translate('Coleção')); ?></span><input name="template_collection" type="text" value="<?php echo esc_attr((string) ($templates['collection'] ?? 'collection')); ?>" placeholder="collection"></label>
                        </div>
                        <p class="submit"><button class="button button-primary" type="submit"><?php echo esc_html($translate('Salvar configuração')); ?></button></p>
                    </form>
                    <?php if ($has_storefront): ?>
                        <form class="kodefy-inline-form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                            <input type="hidden" name="action" value="kodefy_test_connection"><?php wp_nonce_field('kodefy_test_connection'); ?><button class="button" type="submit"><?php echo esc_html($translate('Testar conexão')); ?></button>
                        </form>
                    <?php endif; ?>
                </main>
                <aside class="kodefy-card kodefy-card--exports">
                    <h2><?php echo esc_html($translate('Começar')); ?></h2>
                    <ol class="kodefy-steps"><li><?php echo esc_html($translate('Abra Kodefy Commerce em Kodety → Templates.')); ?></li><li><?php echo esc_html($translate('Edite páginas e estilos visualmente.')); ?></li><li><?php echo esc_html($translate('Publique no WordPress para usar o backend Shopify.')); ?></li></ol>
                    <?php if (class_exists('\\Kodety_Template_Library')): ?><a class="button button-primary" href="<?php echo esc_url(admin_url('admin.php?page=kodety-templates')); ?>"><?php echo esc_html($translate('Abrir biblioteca de templates')); ?></a><?php endif; ?>
                    <?php $this->action_form('kodefy_download_kit', 'Baixar kit para Kodety', 'button button-primary'); ?>
                    <?php
                    $checkout_copy = $translate('O botão Comprar usa checkoutUrl do carrinho e leva o cliente ao checkout oficial. Pagamento, pedido e rastreio continuam na Shopify.');
                    $checkout_parts = explode('checkoutUrl', $checkout_copy, 2);
                    ?>
                    <div class="kodefy-admin__note"><strong><?php echo esc_html($translate('Checkout e pedidos')); ?></strong><p><?php if (count($checkout_parts) === 2): ?><?php echo esc_html($checkout_parts[0]); ?><code>checkoutUrl</code><?php echo esc_html($checkout_parts[1]); ?><?php else: ?><?php echo esc_html($checkout_copy); ?><?php endif; ?></p></div>
                </aside>
            </div>
        </div>
        <?php
    }

    private function action_form(string $action, string $label, string $class, string $hint = ''): void {
        $i18n = class_exists('\Kodety_Admin_I18n') ? \Kodety_Admin_I18n::instance() : null;
        if ($i18n) {
            $label = $i18n->translate($label);
            if ($hint !== '') $hint = $i18n->translate($hint);
        }
        ?>
        <form class="kodefy-export" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="<?php echo esc_attr($action); ?>">
            <?php wp_nonce_field($action); ?>
            <button type="submit" class="<?php echo esc_attr($class); ?>"><?php echo esc_html($label); ?></button>
            <?php if ($hint !== ''): ?><small><?php echo esc_html($hint); ?></small><?php endif; ?>
        </form>
        <?php
    }

    private function exporter(): Kodefy_Theme_Exporter {
        return new Kodefy_Theme_Exporter(dirname(__DIR__));
    }

    private function assert_admin(string $nonce): void {
        if (!current_user_can('manage_options')) wp_die('Sem permissão.', '', ['response' => 403]);
        check_admin_referer($nonce);
    }

    private function redirect_notice(string $type, string $message): void {
        set_transient('kodefy_notice_' . get_current_user_id(), [
            'type' => $type === 'success' ? 'success' : 'error',
            'message' => sanitize_text_field($message),
        ], 120);
        wp_safe_redirect(admin_url('admin.php?page=kodefy-shopify'));
        exit;
    }

    private function send_zip(string $path, string $name): void {
        if (!is_file($path) || filesize($path) <= 0) throw new \RuntimeException('O pacote foi gerado sem conteúdo.');
        while (ob_get_level() > 0) ob_end_clean();
        nocache_headers();
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', $name) . '"');
        header('Content-Length: ' . filesize($path));
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        @unlink($path);
        exit;
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    private function persist_settings(array $input): array {
        $current = $this->settings();
        $read = static function (array $source, string $snake, string $camel, mixed $fallback = ''): mixed {
            if (array_key_exists($snake, $source)) return $source[$snake];
            if (array_key_exists($camel, $source)) return $source[$camel];
            return $fallback;
        };
        $domain = strtolower(trim((string) $read(
            $input,
            'shop_domain',
            'shopDomain',
            (string) ($current['shopDomain'] ?? '')
        )));
        $domain = preg_replace('~^https?://~', '', $domain) ?? '';
        $domain = trim($domain, '/');
        if ($domain !== '' && !preg_match('/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/', $domain)) {
            throw new \RuntimeException('Use o domínio permanente da loja no formato nome.myshopify.com.');
        }
        $settings = $current;
        $settings['schemaVersion'] = 2;
        $settings['shopDomain'] = $domain;
        $settings['storefrontTokenType'] = $read(
            $input,
            'storefront_token_type',
            'storefrontTokenType',
            (string) ($current['storefrontTokenType'] ?? 'public')
        ) === 'private'
            ? 'private'
            : 'public';
        $settings['apiVersion'] = API_VERSION;
        $settings['country'] = $this->country_code(
            (string) $read($input, 'country', 'country', (string) ($current['country'] ?? 'BR')),
            'BR'
        );
        $settings['language'] = $this->country_code(
            (string) $read($input, 'language', 'language', (string) ($current['language'] ?? 'PT')),
            'PT'
        );
        $submitted_routes = is_array($input['routes'] ?? null) ? $input['routes'] : [];
        $settings['routes'] = [];
        foreach (['shop', 'product', 'collection', 'cart', 'search', 'wishlist'] as $key) {
            $value = array_key_exists('route_' . $key, $input)
                ? $input['route_' . $key]
                : ($submitted_routes[$key] ?? ($current['routes'][$key] ?? '/' . $key . '/'));
            $settings['routes'][$key] = $this->route((string) $value);
        }
        $submitted_templates = is_array($input['templates'] ?? null) ? $input['templates'] : [];
        $settings['templates'] = [];
        foreach (['product', 'collection'] as $key) {
            $value = array_key_exists('template_' . $key, $input)
                ? $input['template_' . $key]
                : ($submitted_templates[$key] ?? ($current['templates'][$key] ?? $key));
            $settings['templates'][$key] = $this->template_route($value, $key);
        }
        $submitted_checkout = is_array($input['checkout'] ?? null) ? $input['checkout'] : [];
        $current_checkout = $this->checkout_settings($current);
        $checkout_read = static function (string $camel, string $snake, mixed $fallback = '') use ($submitted_checkout, $input): mixed {
            if (array_key_exists($camel, $submitted_checkout)) return $submitted_checkout[$camel];
            if (array_key_exists($snake, $input)) return $input[$snake];
            return $fallback;
        };
        $provider = sanitize_key((string) $checkout_read('provider', 'checkout_provider', $current_checkout['provider']));
        if (!in_array($provider, ['shopify', 'appmax_shopify', 'yampi', 'cartpanda', 'appmax', 'custom'], true)) $provider = 'shopify';
        $strategy = sanitize_key((string) $checkout_read('strategy', 'checkout_strategy', $current_checkout['strategy']));
        if (!in_array($strategy, ['native', 'link', 'session'], true)) $strategy = 'native';
        if (in_array($provider, ['shopify', 'appmax_shopify'], true)) $strategy = 'native';
        $experience = sanitize_key((string) $checkout_read('experience', 'checkout_experience', $current_checkout['experience']));
        if (!in_array($experience, ['redirect', 'overlay'], true)) $experience = 'redirect';
        $endpoint_url = $this->checkout_url_setting(
            (string) $checkout_read('endpointUrl', 'checkout_endpoint_url', $current_checkout['endpointUrl']),
            'endpoint de sessão'
        );
        $link_template = $this->checkout_url_setting(
            (string) $checkout_read('linkTemplate', 'checkout_link_template', $current_checkout['linkTemplate']),
            'template de link'
        );
        $allowed_hosts = $this->checkout_allowed_hosts(
            $checkout_read('allowedHosts', 'checkout_allowed_hosts', $current_checkout['allowedHosts'])
        );
        $overlay_selector = trim((string) $checkout_read('overlaySelector', 'checkout_overlay_selector', $current_checkout['overlaySelector']));
        if (!preg_match('/^(?:#[A-Za-z][A-Za-z0-9_:-]*|\.[A-Za-z][A-Za-z0-9_-]*|\[data-[a-z0-9-]+\])$/', $overlay_selector)) {
            $overlay_selector = '[data-kodefy-checkout-overlay]';
        }
        $settings['checkout'] = [
            'provider' => $provider,
            'strategy' => $strategy,
            'experience' => $experience,
            'endpointUrl' => $endpoint_url,
            'endpointSecret' => (string) $current_checkout['endpointSecret'],
            'linkTemplate' => $link_template,
            'allowedHosts' => $allowed_hosts,
            'fallbackToShopify' => filter_var(
                $checkout_read('fallbackToShopify', 'checkout_fallback_to_shopify', $current_checkout['fallbackToShopify']),
                FILTER_VALIDATE_BOOLEAN
            ),
            'openInNewTab' => filter_var(
                $checkout_read('openInNewTab', 'checkout_open_in_new_tab', $current_checkout['openInNewTab']),
                FILTER_VALIDATE_BOOLEAN
            ),
            'overlaySelector' => $overlay_selector,
            'returnPath' => $this->route((string) $checkout_read('returnPath', 'checkout_return_path', $current_checkout['returnPath'])),
            'cancelPath' => $this->route((string) $checkout_read('cancelPath', 'checkout_cancel_path', $current_checkout['cancelPath'])),
        ];
        $endpoint_secret = trim((string) $checkout_read('endpointSecret', 'checkout_endpoint_secret'));
        if (!empty($input['clear_checkout_endpoint_secret']) || !empty($input['clearCheckoutEndpointSecret']) || !empty($submitted_checkout['clearEndpointSecret'])) {
            $settings['checkout']['endpointSecret'] = '';
        } elseif ($endpoint_secret !== '') {
            $settings['checkout']['endpointSecret'] = Kodefy_Crypto::encrypt($endpoint_secret);
        }
        $storefront_token = trim((string) $read($input, 'storefront_token', 'storefrontToken'));
        if (!empty($input['clear_storefront_token']) || !empty($input['clearStorefrontToken'])) {
            $settings['storefrontToken'] = '';
        } elseif ($storefront_token !== '') {
            $settings['storefrontToken'] = Kodefy_Crypto::encrypt($storefront_token);
        }
        if (!\Kodety_Extensions::instance()->update_settings(SLUG, $settings)) {
            throw new \RuntimeException('O WordPress não confirmou o salvamento da configuração.');
        }
        // Published HTML contains the runtime's `configured` flag. Without a
        // full-page/CDN purge, pages cached before the connection was saved can
        // alternate with fresh pages and make products appear intermittently.
        $this->purge_published_cache();
        delete_transient(self::BUILDER_SNAPSHOT_TRANSIENT);
        return $settings;
    }

    /** Register Shopify as a first-class, integration-managed Kodety CMS source. */
    public function ensure_managed_collections(): void {
        if (!class_exists('\\Kodety_Plugin') || !(new Kodefy_Shopify($this->settings()))->configured()) return;
        $plugin = \Kodety_Plugin::instance();
        if (!method_exists($plugin, 'project_cms_option') || !method_exists($plugin, 'update_project_cms_option')) return;
        $stored = $plugin->project_cms_option('kodety_collections', []);
        $definitions = is_array($stored) ? array_values(array_filter($stored, 'is_array')) : [];
        $settings = $this->settings();
        $routes = is_array($settings['routes'] ?? null) ? $settings['routes'] : [];
        $managed = [
            $this->managed_collection_definition(
                self::PRODUCT_POST_TYPE,
                'Produtos Shopify',
                'Produto Shopify',
                trim((string) ($routes['product'] ?? '/products/'), '/'),
                $this->product_fields()
            ),
            $this->managed_collection_definition(
                self::COLLECTION_POST_TYPE,
                'Coleções Shopify',
                'Coleção Shopify',
                trim((string) ($routes['collection'] ?? '/collections/'), '/'),
                $this->collection_fields()
            ),
        ];
        foreach ($managed as $definition) {
            $found = false;
            foreach ($definitions as $index => $current) {
                if (sanitize_key((string) ($current['slug'] ?? '')) !== $definition['slug']) continue;
                $definitions[$index] = $definition;
                $found = true;
                break;
            }
            if (!$found) $definitions[] = $definition;
        }
        if (maybe_serialize($definitions) === maybe_serialize($stored)) return;
        if ($plugin->update_project_cms_option('kodety_collections', $definitions, $stored)) flush_rewrite_rules(false);
    }

    public function schedule_catalog_sync(): void {
        if (!(new Kodefy_Shopify($this->settings()))->configured()) return;
        if (!wp_next_scheduled(self::CATALOG_SYNC_HOOK)) {
            wp_schedule_event(time() + MINUTE_IN_SECONDS, 'kodefy_fifteen_minutes', self::CATALOG_SYNC_HOOK);
            wp_schedule_single_event(time() + 5, self::CATALOG_SYNC_HOOK);
        }
    }

    /** @param array<string,array<string,mixed>> $schedules @return array<string,array<string,mixed>> */
    public function catalog_sync_schedule(array $schedules): array {
        $schedules['kodefy_fifteen_minutes'] = [
            'interval' => 15 * MINUTE_IN_SECONDS,
            'display' => 'A cada 15 minutos (Kodefy Shopify)',
        ];
        return $schedules;
    }

    public function sync_scheduled_catalog(mixed $reason = null): void {
        $this->sync_builder_data(true);
    }

    /** @param array<int,array<string,mixed>> $fields @return array<string,mixed> */
    private function managed_collection_definition(string $slug, string $name, string $singular, string $url_slug, array $fields): array {
        return [
            'slug' => $slug,
            'name' => $name,
            'singular' => $singular,
            'urlSlug' => sanitize_title($url_slug) ?: ($slug === self::PRODUCT_POST_TYPE ? 'products' : 'collections'),
            'fields' => $fields,
            'readOnly' => true,
            'managedBy' => SLUG,
        ];
    }

    /** @return array<int,array<string,mixed>> */
    private function product_fields(): array {
        return [
            ['name' => 'shopify_id', 'label' => 'Shopify ID', 'type' => 'text'],
            ['name' => 'vendor', 'label' => 'Marca', 'type' => 'text'],
            ['name' => 'product_type', 'label' => 'Tipo de produto', 'type' => 'text'],
            ['name' => 'description_html', 'label' => 'Descrição HTML', 'type' => 'richtext'],
            ['name' => 'available', 'label' => 'Disponível', 'type' => 'boolean'],
            ['name' => 'price', 'label' => 'Preço', 'type' => 'number'],
            ['name' => 'compare_at_price', 'label' => 'Preço anterior', 'type' => 'number'],
            ['name' => 'currency', 'label' => 'Moeda', 'type' => 'text'],
            ['name' => 'featured_image', 'label' => 'Imagem principal', 'type' => 'image'],
            ['name' => 'images_json', 'label' => 'Imagens (JSON)', 'type' => 'textarea'],
            ['name' => 'variants_json', 'label' => 'Variantes (JSON)', 'type' => 'textarea'],
            ['name' => 'variant_id', 'label' => 'Variante principal', 'type' => 'text'],
            ['name' => 'variant_available', 'label' => 'Variante disponível', 'type' => 'boolean'],
            ['name' => 'variant_quantity', 'label' => 'Estoque da variante', 'type' => 'number'],
            ['name' => 'seo_title', 'label' => 'Título SEO', 'type' => 'text'],
            ['name' => 'seo_description', 'label' => 'Descrição SEO', 'type' => 'textarea'],
        ];
    }

    /** @return array<int,array<string,mixed>> */
    private function collection_fields(): array {
        return [
            ['name' => 'shopify_id', 'label' => 'Shopify ID', 'type' => 'text'],
            ['name' => 'description_html', 'label' => 'Descrição HTML', 'type' => 'richtext'],
            ['name' => 'featured_image', 'label' => 'Imagem principal', 'type' => 'image'],
            ['name' => 'product_handles_json', 'label' => 'Produtos (JSON)', 'type' => 'textarea'],
            ['name' => 'seo_title', 'label' => 'Título SEO', 'type' => 'text'],
            ['name' => 'seo_description', 'label' => 'Descrição SEO', 'type' => 'textarea'],
        ];
    }

    private function request_route(): string {
        $request_path = trim(rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH)), '/');
        $home_path = trim((string) parse_url(home_url('/'), PHP_URL_PATH), '/');
        if ($home_path !== '' && ($request_path === $home_path || str_starts_with($request_path, $home_path . '/'))) {
            $request_path = trim(substr($request_path, strlen($home_path)), '/');
        }
        return $request_path;
    }

    /** @return array{kind:string,handle:string,template:string,requestRoute:string}|null */
    private function captured_dynamic_route(): ?array {
        $kind = sanitize_key((string) get_query_var('kodefy_dynamic_kind'));
        $handle = sanitize_title((string) get_query_var('kodefy_dynamic_handle'));
        $template = trim((string) get_query_var('kodefy_dynamic_template'), '/');
        $request_route = trim((string) get_query_var('kodefy_dynamic_request'), '/');
        if (!in_array($kind, ['product', 'collection'], true) || $handle === '' || $template === '') return null;
        return [
            'kind' => $kind,
            'handle' => $handle,
            'template' => $template,
            'requestRoute' => $request_route,
        ];
    }

    /** @return array{kind:string,handle:string,template:string,requestRoute:string}|null */
    private function match_dynamic_route(string $request_route): ?array {
        $request_route = trim(str_replace('\\', '/', rawurldecode($request_route)), '/');
        $settings = $this->settings();
        $routes = is_array($settings['routes'] ?? null) ? $settings['routes'] : [];
        $templates = is_array($settings['templates'] ?? null) ? $settings['templates'] : [];
        foreach (['product', 'collection'] as $kind) {
            $configured = trim((string) ($routes[$kind] ?? '/' . $kind . 's/'), '/');
            $bases = array_values(array_unique(array_filter([
                $configured,
                $kind === 'product' ? 'products' : 'collections',
            ])));
            foreach ($bases as $base) {
                if (!str_starts_with($request_route . '/', $base . '/')) continue;
                $handle = trim(substr($request_route, strlen($base)), '/');
                if ($handle === '' || str_contains($handle, '/') || !preg_match('/^[a-z0-9][a-z0-9-]{0,254}$/', $handle)) continue;
                return [
                    'kind' => $kind,
                    'handle' => $handle,
                    'template' => $this->template_route($templates[$kind] ?? $kind, $kind),
                    'requestRoute' => $request_route,
                ];
            }
        }
        return null;
    }

    private function template_route(mixed $value, string $fallback): string {
        $value = trim(str_replace('\\', '/', (string) $value), '/');
        $value = (string) preg_replace('/\.html?$/i', '', $value);
        if ($value === '' || str_contains($value, '..')) return $fallback;
        $segments = array_values(array_filter(array_map(
            static fn(string $segment): string => sanitize_title($segment),
            explode('/', $value)
        )));
        return $segments ? implode('/', $segments) : $fallback;
    }

    private function purge_published_cache(): void {
        if (class_exists('\Kodety_Plugin') && method_exists('\Kodety_Plugin', 'instance')) {
            $plugin = \Kodety_Plugin::instance();
            if (method_exists($plugin, 'purge_cache_rest')) {
                $plugin->purge_cache_rest();
                return;
            }
        }
        if (function_exists('wp_cache_flush')) wp_cache_flush();
        do_action('kodety_purge_published_cache');
    }

    /** @return array<string,mixed>|\WP_Error */
    private function sync_builder_data(bool $force = false): array|\WP_Error {
        $settings = $this->settings();
        $shopify = new Kodefy_Shopify($settings);
        $routes = is_array($settings['routes'] ?? null) ? $settings['routes'] : [];
        if (!$shopify->configured()) {
            return [
                'schemaVersion' => 1,
                'configured' => false,
                'shopDomain' => $shopify->domain(),
                'shop' => '',
                'currency' => '',
                'routes' => $routes,
                'syncedAt' => '',
                'products' => ['nodes' => [], 'pageInfo' => ['hasNextPage' => false, 'endCursor' => null]],
                'collections' => ['nodes' => [], 'pageInfo' => ['hasNextPage' => false, 'endCursor' => null]],
            ];
        }

        if (!$force) {
            $cached = get_transient(self::BUILDER_SNAPSHOT_TRANSIENT);
            if (
                is_array($cached)
                && hash_equals($shopify->domain(), (string) ($cached['shopDomain'] ?? ''))
                && is_array($cached['products'] ?? null)
            ) return $cached;
        }

        $catalog = (new Kodefy_Storefront($this))->builder_catalog(50);
        if (is_wp_error($catalog)) return $catalog;
        $products = is_array($catalog['products'] ?? null) ? $catalog['products'] : ['nodes' => []];
        if (!is_array($products['nodes'] ?? null)) $products['nodes'] = [];
        $shop = is_array($catalog['shop'] ?? null) ? $catalog['shop'] : [];
        $payment = is_array($shop['paymentSettings'] ?? null) ? $shop['paymentSettings'] : [];
        $snapshot = [
            'schemaVersion' => 1,
            'configured' => true,
            'shopDomain' => $shopify->domain(),
            'shop' => sanitize_text_field((string) ($shop['name'] ?? 'Shopify')),
            'currency' => sanitize_text_field((string) ($payment['currencyCode'] ?? '')),
            'routes' => $routes,
            'syncedAt' => gmdate('c'),
            'products' => $products,
            'collections' => is_array($catalog['collections'] ?? null)
                ? $catalog['collections']
                : ['nodes' => [], 'pageInfo' => ['hasNextPage' => false, 'endCursor' => null]],
        ];
        if ($force) {
            $managed = $this->sync_managed_catalog($catalog);
            $snapshot['managedCollections'] = is_wp_error($managed)
                ? ['error' => $managed->get_error_message()]
                : $managed;
        }
        set_transient(self::BUILDER_SNAPSHOT_TRANSIENT, $snapshot, self::BUILDER_SNAPSHOT_TTL);
        return $snapshot;
    }

    /** @param array<string,mixed> $first_page @return array<string,mixed>|\WP_Error */
    private function sync_managed_catalog(array $first_page): array|\WP_Error {
        $this->ensure_managed_collections();
        if (!post_type_exists(self::PRODUCT_POST_TYPE) || !post_type_exists(self::COLLECTION_POST_TYPE)) {
            if (class_exists('\\Kodety_Plugin')) \Kodety_Plugin::instance()->register_collections();
        }
        if (!post_type_exists(self::PRODUCT_POST_TYPE) || !post_type_exists(self::COLLECTION_POST_TYPE)) {
            return new \WP_Error('kodefy_cms_unavailable', 'As collections gerenciadas da Shopify não puderam ser registradas.', ['status' => 500]);
        }

        $products = is_array($first_page['products']['nodes'] ?? null) ? $first_page['products']['nodes'] : [];
        $collections = is_array($first_page['collections']['nodes'] ?? null) ? $first_page['collections']['nodes'] : [];
        $product_info = is_array($first_page['products']['pageInfo'] ?? null) ? $first_page['products']['pageInfo'] : [];
        $collection_info = is_array($first_page['collections']['pageInfo'] ?? null) ? $first_page['collections']['pageInfo'] : [];
        $product_cursor = is_string($product_info['endCursor'] ?? null) ? $product_info['endCursor'] : null;
        $collection_cursor = is_string($collection_info['endCursor'] ?? null) ? $collection_info['endCursor'] : null;
        $page = 1;
        while ((!empty($product_info['hasNextPage']) || !empty($collection_info['hasNextPage'])) && $page < 20) {
            $next = (new Kodefy_Storefront($this))->builder_catalog(50, $product_cursor, $collection_cursor);
            if (is_wp_error($next)) return $next;
            $next_products = is_array($next['products']['nodes'] ?? null) ? $next['products']['nodes'] : [];
            $next_collections = is_array($next['collections']['nodes'] ?? null) ? $next['collections']['nodes'] : [];
            $products = array_merge($products, $next_products);
            $collections = array_merge($collections, $next_collections);
            $product_info = is_array($next['products']['pageInfo'] ?? null) ? $next['products']['pageInfo'] : [];
            $collection_info = is_array($next['collections']['pageInfo'] ?? null) ? $next['collections']['pageInfo'] : [];
            if (is_string($product_info['endCursor'] ?? null)) $product_cursor = $product_info['endCursor'];
            if (is_string($collection_info['endCursor'] ?? null)) $collection_cursor = $collection_info['endCursor'];
            $page += 1;
        }
        $products = $this->unique_shopify_nodes($products);
        $collections = $this->unique_shopify_nodes($collections);
        $products_complete = empty($product_info['hasNextPage']);
        $collections_complete = empty($collection_info['hasNextPage']);
        $product_result = $this->sync_managed_posts(self::PRODUCT_POST_TYPE, $products, $products_complete);
        if (is_wp_error($product_result)) return $product_result;
        $collection_result = $this->sync_managed_posts(self::COLLECTION_POST_TYPE, $collections, $collections_complete);
        if (is_wp_error($collection_result)) return $collection_result;
        $this->purge_published_cache();
        return [
            'syncedAt' => gmdate('c'),
            'products' => $product_result,
            'collections' => $collection_result,
        ];
    }

    /** @param array<int,mixed> $nodes @return array<int,array<string,mixed>> */
    private function unique_shopify_nodes(array $nodes): array {
        $unique = [];
        foreach ($nodes as $node) {
            if (!is_array($node)) continue;
            $id = sanitize_text_field((string) ($node['id'] ?? ''));
            $handle = sanitize_title((string) ($node['handle'] ?? ''));
            if ($id === '' || $handle === '') continue;
            $unique[$id] = $node;
        }
        return array_values($unique);
    }

    /** @param array<int,array<string,mixed>> $nodes @return array<string,int>|\WP_Error */
    private function sync_managed_posts(string $post_type, array $nodes, bool $complete): array|\WP_Error {
        $settings = $this->settings();
        $domain = (new Kodefy_Shopify($settings))->domain();
        $project_id = get_option('kodety_workspace_mode', 'single') === 'agency'
            ? sanitize_key((string) get_option('kodety_agency_active_project', ''))
            : '';
        $meta_query = [[
            'key' => '_kodefy_shop_domain',
            'value' => $domain,
            'compare' => '=',
        ]];
        if ($project_id !== '') {
            $meta_query[] = ['key' => '_kodety_project_id', 'value' => $project_id, 'compare' => '='];
        }
        $existing_ids = get_posts([
            'post_type' => $post_type,
            'post_status' => ['publish', 'draft', 'pending', 'private', 'trash'],
            'posts_per_page' => -1,
            'fields' => 'ids',
            'no_found_rows' => true,
            'meta_query' => $meta_query,
        ]);
        $existing = [];
        foreach ($existing_ids as $post_id) {
            $shopify_id = (string) get_post_meta((int) $post_id, '_kodefy_shopify_id', true);
            if ($shopify_id !== '') $existing[$shopify_id] = (int) $post_id;
        }
        $seen = [];
        $created = 0;
        $updated = 0;
        foreach ($nodes as $node) {
            $shopify_id = sanitize_text_field((string) ($node['id'] ?? ''));
            $handle = sanitize_title((string) ($node['handle'] ?? ''));
            $title = sanitize_text_field((string) ($node['title'] ?? ''));
            if ($shopify_id === '' || $handle === '' || $title === '') continue;
            $seen[$shopify_id] = true;
            $payload = $post_type === self::PRODUCT_POST_TYPE
                ? $this->product_post_payload($node)
                : $this->collection_post_payload($node);
            $hash = hash('sha256', (string) wp_json_encode($payload));
            $post_id = (int) ($existing[$shopify_id] ?? 0);
            if ($post_id > 0 && hash_equals($hash, (string) get_post_meta($post_id, '_kodefy_payload_hash', true))) continue;
            $postarr = wp_slash([
                'ID' => $post_id,
                'post_type' => $post_type,
                'post_status' => 'publish',
                'post_name' => $handle,
                'post_title' => $title,
                'post_excerpt' => (string) ($node['description'] ?? ''),
                'post_content' => wp_kses_post((string) ($node['descriptionHtml'] ?? '')),
            ]);
            $result = wp_insert_post($postarr, true);
            if (is_wp_error($result)) return $result;
            $post_id = (int) $result;
            foreach ($payload as $key => $value) update_post_meta($post_id, $key, $value);
            update_post_meta($post_id, '_kodefy_shopify_id', $shopify_id);
            update_post_meta($post_id, '_kodefy_shop_domain', $domain);
            update_post_meta($post_id, '_kodefy_payload_hash', $hash);
            update_post_meta($post_id, '_kodefy_managed', '1');
            if ($project_id !== '') update_post_meta($post_id, '_kodety_project_id', $project_id);
            if (isset($existing[$shopify_id])) $updated += 1;
            else $created += 1;
        }
        $removed = 0;
        if ($complete) {
            foreach ($existing as $shopify_id => $post_id) {
                if (isset($seen[$shopify_id])) continue;
                if (get_post_status($post_id) !== 'trash' && wp_trash_post($post_id)) $removed += 1;
            }
        }
        return ['total' => count($seen), 'created' => $created, 'updated' => $updated, 'removed' => $removed];
    }

    /** @param array<string,mixed> $node @return array<string,mixed> */
    private function product_post_payload(array $node): array {
        $minimum = is_array($node['priceRange']['minVariantPrice'] ?? null) ? $node['priceRange']['minVariantPrice'] : [];
        $compare = is_array($node['compareAtPriceRange']['minVariantPrice'] ?? null) ? $node['compareAtPriceRange']['minVariantPrice'] : [];
        $image = is_array($node['featuredImage'] ?? null) ? $node['featuredImage'] : [];
        $seo = is_array($node['seo'] ?? null) ? $node['seo'] : [];
        $variants = is_array($node['variants']['nodes'] ?? null)
            ? array_values(array_filter($node['variants']['nodes'], 'is_array'))
            : [];
        $primary_variant = null;
        foreach ($variants as $variant) {
            if (!empty($variant['availableForSale'])) { $primary_variant = $variant; break; }
        }
        if (!is_array($primary_variant)) $primary_variant = is_array($variants[0] ?? null) ? $variants[0] : [];
        return [
            'shopify_id' => sanitize_text_field((string) ($node['id'] ?? '')),
            'vendor' => sanitize_text_field((string) ($node['vendor'] ?? '')),
            'product_type' => sanitize_text_field((string) ($node['productType'] ?? '')),
            'description_html' => wp_kses_post((string) ($node['descriptionHtml'] ?? '')),
            'available' => !empty($node['availableForSale']) ? '1' : '',
            'price' => (string) ($minimum['amount'] ?? ''),
            'compare_at_price' => (string) ($compare['amount'] ?? ''),
            'currency' => sanitize_text_field((string) ($minimum['currencyCode'] ?? '')),
            'featured_image' => [
                'url' => esc_url_raw((string) ($image['url'] ?? '')),
                'alt' => sanitize_text_field((string) ($image['altText'] ?? '')),
                'focalX' => 50,
                'focalY' => 50,
                'crop' => 'original',
            ],
            'images_json' => (string) wp_json_encode($node['images']['nodes'] ?? []),
            'variants_json' => (string) wp_json_encode($variants),
            'variant_id' => sanitize_text_field((string) ($primary_variant['id'] ?? '')),
            'variant_available' => !empty($primary_variant['availableForSale']) ? '1' : '',
            'variant_quantity' => isset($primary_variant['quantityAvailable']) && is_numeric($primary_variant['quantityAvailable'])
                ? (string) (int) $primary_variant['quantityAvailable']
                : '',
            'seo_title' => sanitize_text_field((string) ($seo['title'] ?? $node['title'] ?? '')),
            'seo_description' => sanitize_textarea_field((string) ($seo['description'] ?? $node['description'] ?? '')),
        ];
    }

    /** @param array<string,mixed> $node @return array<string,mixed> */
    private function collection_post_payload(array $node): array {
        $image = is_array($node['image'] ?? null) ? $node['image'] : [];
        $seo = is_array($node['seo'] ?? null) ? $node['seo'] : [];
        return [
            'shopify_id' => sanitize_text_field((string) ($node['id'] ?? '')),
            'description_html' => wp_kses_post((string) ($node['descriptionHtml'] ?? '')),
            'featured_image' => [
                'url' => esc_url_raw((string) ($image['url'] ?? '')),
                'alt' => sanitize_text_field((string) ($image['altText'] ?? '')),
                'focalX' => 50,
                'focalY' => 50,
                'crop' => 'original',
            ],
            'product_handles_json' => (string) wp_json_encode(array_values(array_filter(array_map(
                static fn(mixed $product): string => is_array($product) ? sanitize_title((string) ($product['handle'] ?? '')) : '',
                is_array($node['products']['nodes'] ?? null) ? $node['products']['nodes'] : []
            )))),
            'seo_title' => sanitize_text_field((string) ($seo['title'] ?? $node['title'] ?? '')),
            'seo_description' => sanitize_textarea_field((string) ($seo['description'] ?? $node['description'] ?? '')),
        ];
    }

    /** @param array<string,mixed> $snapshot @return array<string,mixed> */
    private function snapshot_summary(array $snapshot): array {
        $products = is_array($snapshot['products'] ?? null) ? $snapshot['products'] : [];
        $nodes = is_array($products['nodes'] ?? null) ? $products['nodes'] : [];
        return [
            'configured' => !empty($snapshot['configured']),
            'syncedAt' => (string) ($snapshot['syncedAt'] ?? ''),
            'productCount' => count($nodes),
            'hasMoreProducts' => !empty($products['pageInfo']['hasNextPage']),
        ];
    }

    /** @param array<string,mixed> $settings @return array<string,mixed> */
    private function checkout_settings(array $settings): array {
        $stored = is_array($settings['checkout'] ?? null) ? $settings['checkout'] : [];
        return array_replace([
            'provider' => 'shopify',
            'strategy' => 'native',
            'experience' => 'redirect',
            'endpointUrl' => '',
            'endpointSecret' => '',
            'linkTemplate' => '',
            'allowedHosts' => [],
            'fallbackToShopify' => true,
            'openInNewTab' => false,
            'overlaySelector' => '[data-kodefy-checkout-overlay]',
            'returnPath' => '/',
            'cancelPath' => is_array($settings['routes'] ?? null)
                ? (string) ($settings['routes']['cart'] ?? '/cart/')
                : '/cart/',
        ], $stored);
    }

    private function checkout_url_setting(string $value, string $label): string {
        $value = trim($value);
        if ($value === '') return '';
        if (strlen($value) > 2048) throw new \RuntimeException('O ' . $label . ' excede o limite de 2.048 caracteres.');
        $probe = preg_replace('/\{[a-z0-9_]+\}/i', 'kodefy', $value) ?? $value;
        $parts = wp_parse_url($probe);
        if (
            !is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || trim((string) ($parts['host'] ?? '')) === ''
            || isset($parts['user'])
            || isset($parts['pass'])
        ) {
            throw new \RuntimeException('Use uma URL HTTPS pública e sem credenciais no ' . $label . '.');
        }
        return $value;
    }

    /** @return string[] */
    private function checkout_allowed_hosts(mixed $value): array {
        $items = is_array($value)
            ? $value
            : preg_split('/[\s,;]+/', (string) $value, -1, PREG_SPLIT_NO_EMPTY);
        $hosts = [];
        foreach (is_array($items) ? $items : [] as $item) {
            $host = strtolower(trim((string) $item));
            $host = preg_replace('~^https?://~', '', $host) ?? '';
            $host = trim(explode('/', $host, 2)[0] ?? '', '.');
            if (str_starts_with($host, '*.')) $host = substr($host, 2);
            if (!preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $host)) continue;
            $hosts[] = $host;
        }
        return array_values(array_unique(array_slice($hosts, 0, 20)));
    }

    private function route(mixed $value): string {
        $path = '/' . trim((string) $value, '/') . '/';
        return $path === '//' ? '/' : $path;
    }

    private function country_code(string $value, string $fallback): string {
        $value = strtoupper(trim($value));
        return preg_match('/^[A-Z]{2}$/', $value) ? $value : $fallback;
    }
}
