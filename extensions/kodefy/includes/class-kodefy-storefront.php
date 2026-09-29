<?php

namespace Kodefy\Shopify;

defined('ABSPATH') || exit;

final class Kodefy_Storefront {
    private Kodefy_Extension $extension;

    public function __construct(Kodefy_Extension $extension) {
        $this->extension = $extension;
    }

    public function register_routes(): void {
        register_rest_route('kodefy/v1', '/products', [
            'methods' => \WP_REST_Server::READABLE,
            'permission_callback' => [$this, 'permit_public_read'],
            'callback' => [$this, 'products'],
        ]);
        register_rest_route('kodefy/v1', '/products/(?P<handle>[a-z0-9][a-z0-9-]{0,254})', [
            'methods' => \WP_REST_Server::READABLE,
            'permission_callback' => [$this, 'permit_public_read'],
            'callback' => [$this, 'product'],
        ]);
        register_rest_route('kodefy/v1', '/collections/(?P<handle>[a-z0-9][a-z0-9-]{0,254})', [
            'methods' => \WP_REST_Server::READABLE,
            'permission_callback' => [$this, 'permit_public_read'],
            'callback' => [$this, 'collection'],
        ]);
        register_rest_route('kodefy/v1', '/cart', [
            [
                'methods' => \WP_REST_Server::READABLE,
                'permission_callback' => [$this, 'permit_public_read'],
                'callback' => [$this, 'cart'],
            ],
            [
                'methods' => \WP_REST_Server::CREATABLE,
                'permission_callback' => [$this, 'permit_cart_write'],
                'callback' => [$this, 'mutate_cart'],
            ],
        ]);
        register_rest_route('kodefy/v1', '/checkout', [
            'methods' => \WP_REST_Server::CREATABLE,
            'permission_callback' => [$this, 'permit_cart_write'],
            'callback' => [$this, 'checkout'],
        ]);
    }

    public function permit_public_read(): bool|\WP_Error {
        return $this->rate_limit(180);
    }

    public function permit_cart_write(): bool|\WP_Error {
        $limited = $this->rate_limit(120);
        if (is_wp_error($limited)) return $limited;
        $origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
        if ($origin === '') return true;
        $expected = wp_parse_url(home_url('/'));
        $actual = wp_parse_url($origin);
        if (!is_array($expected) || !is_array($actual)) {
            return new \WP_Error('kodefy_origin', 'Origem inválida.', ['status' => 403]);
        }
        $expected_port = (int) ($expected['port'] ?? (($expected['scheme'] ?? '') === 'https' ? 443 : 80));
        $actual_port = (int) ($actual['port'] ?? (($actual['scheme'] ?? '') === 'https' ? 443 : 80));
        if (
            strtolower((string) ($expected['scheme'] ?? '')) !== strtolower((string) ($actual['scheme'] ?? ''))
            || strtolower((string) ($expected['host'] ?? '')) !== strtolower((string) ($actual['host'] ?? ''))
            || $expected_port !== $actual_port
        ) {
            return new \WP_Error('kodefy_origin', 'Operações de carrinho aceitam somente a origem desta loja.', ['status' => 403]);
        }
        return true;
    }

    public function products(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $sort = strtoupper(sanitize_key((string) $request->get_param('sort')));
        $allowed = ['BEST_SELLING', 'CREATED_AT', 'ID', 'PRICE', 'PRODUCT_TYPE', 'RELEVANCE', 'TITLE', 'UPDATED_AT', 'VENDOR'];
        if (!in_array($sort, $allowed, true)) $sort = 'BEST_SELLING';
        $variables = $this->context([
            'first' => max(1, min(50, (int) ($request->get_param('first') ?: 12))),
            'query' => $this->search_query((string) ($request->get_param('query') ?? '')),
            'sortKey' => $sort,
            'reverse' => filter_var($request->get_param('reverse'), FILTER_VALIDATE_BOOLEAN),
        ]);
        // Cache only bounded catalog permutations. Free-form search terms stay
        // uncached so public input cannot create an unbounded transient set.
        $data = $variables['query'] === null
            ? $this->cached_storefront('products', self::products_query(), $variables, 30)
            : $this->shopify()->storefront(self::products_query(), $variables, self::buyer_ip());
        return $this->respond($data, 'products');
    }

    /**
     * Fetch the compact catalog snapshot consumed by the visual Builder.
     *
     * The Builder runs its canvas in an opaque iframe, so commerce data must
     * cross the authenticated WordPress shell instead of being fetched by
     * every preview frame independently.
     *
     * @return array<string,mixed>|\WP_Error
     */
    public function builder_catalog(int $first = 24, ?string $after = null, ?string $collection_after = null): array|\WP_Error {
        return $this->shopify()->storefront(
            self::builder_catalog_query(),
            $this->context([
                'first' => max(1, min(50, $first)),
                'after' => $after,
                'collectionAfter' => $collection_after,
            ]),
            self::buyer_ip()
        );
    }

    public function product(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $variables = $this->context(['handle' => sanitize_title((string) $request['handle'])]);
        $data = $this->cached_storefront('product', self::product_query(), $variables, 30);
        return $this->respond($data, 'product');
    }

    public function collection(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $variables = $this->context([
            'handle' => sanitize_title((string) $request['handle']),
            'first' => max(1, min(50, (int) ($request->get_param('first') ?: 24))),
        ]);
        $data = $this->cached_storefront('collection', self::collection_query(), $variables, 30);
        return $this->respond($data, 'collection');
    }

    public function cart(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $cart_id = $this->gid((string) $request->get_param('id'), 'Cart');
        if ($cart_id === '') return new \WP_Error('kodefy_cart_id', 'Carrinho inválido.', ['status' => 400]);
        $data = $this->shopify()->storefront(self::cart_query(), ['id' => $cart_id], self::buyer_ip());
        return $this->respond($data, 'cart');
    }

    public function mutate_cart(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $payload = $request->get_json_params();
        if (!is_array($payload)) $payload = [];
        $action = sanitize_key((string) ($payload['action'] ?? ''));
        $shopify = $this->shopify();

        if ($action === 'create') {
            $variant_id = $this->gid((string) ($payload['variantId'] ?? ''), 'ProductVariant');
            if ($variant_id === '') return new \WP_Error('kodefy_variant_id', 'Variação inválida.', ['status' => 400]);
            $quantity = max(1, min(99, (int) ($payload['quantity'] ?? 1)));
            // Do not pin a new cart to the catalog's display country. Shopify
            // Markets may expose inventory in catalog queries while rejecting
            // the same merchandise once buyerIdentity selects a market without
            // an eligible fulfillment location. Checkout will resolve the
            // buyer's actual market from their address.
            $input = ['lines' => [['merchandiseId' => $variant_id, 'quantity' => $quantity]]];
            $data = $shopify->storefront(self::cart_create_mutation(), ['input' => $input], self::buyer_ip());
            return $this->respond($data, 'cartCreate');
        }

        $cart_id = $this->gid((string) ($payload['cartId'] ?? ''), 'Cart');
        if ($cart_id === '') return new \WP_Error('kodefy_cart_id', 'Carrinho inválido.', ['status' => 400]);

        if ($action === 'add') {
            $variant_id = $this->gid((string) ($payload['variantId'] ?? ''), 'ProductVariant');
            if ($variant_id === '') return new \WP_Error('kodefy_variant_id', 'Variação inválida.', ['status' => 400]);
            $variables = [
                'cartId' => $cart_id,
                'lines' => [[
                    'merchandiseId' => $variant_id,
                    'quantity' => max(1, min(99, (int) ($payload['quantity'] ?? 1))),
                ]],
            ];
            $data = $shopify->storefront(self::cart_add_mutation(), $variables, self::buyer_ip());
            return $this->respond($data, 'cartLinesAdd');
        }

        if ($action === 'update') {
            $line_id = $this->gid((string) ($payload['lineId'] ?? ''), 'CartLine');
            if ($line_id === '') return new \WP_Error('kodefy_line_id', 'Item de carrinho inválido.', ['status' => 400]);
            $variables = [
                'cartId' => $cart_id,
                'lines' => [[
                    'id' => $line_id,
                    'quantity' => max(0, min(99, (int) ($payload['quantity'] ?? 1))),
                ]],
            ];
            $data = $shopify->storefront(self::cart_update_mutation(), $variables, self::buyer_ip());
            return $this->respond($data, 'cartLinesUpdate');
        }

        if ($action === 'remove') {
            $line_id = $this->gid((string) ($payload['lineId'] ?? ''), 'CartLine');
            if ($line_id === '') return new \WP_Error('kodefy_line_id', 'Item de carrinho inválido.', ['status' => 400]);
            $data = $shopify->storefront(
                self::cart_remove_mutation(),
                ['cartId' => $cart_id, 'lineIds' => [$line_id]],
                self::buyer_ip()
            );
            return $this->respond($data, 'cartLinesRemove');
        }

        return new \WP_Error('kodefy_cart_action', 'Ação de carrinho não reconhecida.', ['status' => 400]);
    }

    /**
     * Resolve checkout after re-reading the cart from Shopify. Browser prices,
     * line data and destination URLs are never trusted by this endpoint.
     */
    public function checkout(\WP_REST_Request $request): \WP_REST_Response|\WP_Error {
        $payload = $request->get_json_params();
        if (!is_array($payload)) $payload = [];
        $cart_id = $this->gid((string) ($payload['cartId'] ?? ''), 'Cart');
        if ($cart_id === '') return new \WP_Error('kodefy_cart_id', 'Carrinho inválido.', ['status' => 400]);

        $data = $this->shopify()->storefront(self::cart_query(), ['id' => $cart_id], self::buyer_ip());
        if (is_wp_error($data)) return $data;
        $cart = is_array($data['cart'] ?? null) ? $data['cart'] : null;
        if (!is_array($cart)) return new \WP_Error('kodefy_not_found', 'O carrinho não foi encontrado na Shopify.', ['status' => 404]);

        $settings = $this->extension->settings();
        $checkout_settings = is_array($settings['checkout'] ?? null) ? $settings['checkout'] : [];
        $routes = is_array($settings['routes'] ?? null) ? $settings['routes'] : [];
        $return_path = (string) ($checkout_settings['returnPath'] ?? '/');
        $cancel_path = (string) ($checkout_settings['cancelPath'] ?? ($routes['cart'] ?? '/cart/'));
        $return_path = '/' . trim($return_path, '/') . '/';
        $cancel_path = '/' . trim($cancel_path, '/') . '/';
        $context = [
            'returnUrl' => home_url($return_path === '//' ? '/' : $return_path),
            'cancelUrl' => home_url($cancel_path === '//' ? '/' : $cancel_path),
        ];
        // Session idempotency is generated from the freshly loaded Shopify
        // cart inside Kodefy_Checkout. A browser-supplied key must never bind
        // a changed cart to a provider session created for older line items.
        $resolved = (new Kodefy_Checkout($settings))->resolve($cart, $context);
        if (is_wp_error($resolved)) return $resolved;

        $response = new \WP_REST_Response(['ok' => true, 'data' => $resolved]);
        $response->header('Cache-Control', 'private, no-store, max-age=0');
        $response->header('X-Robots-Tag', 'noindex, nofollow');
        return $response;
    }

    public static function buyer_ip(): string {
        $candidate = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
        return filter_var($candidate, FILTER_VALIDATE_IP) ? $candidate : '';
    }

    private function shopify(): Kodefy_Shopify {
        return new Kodefy_Shopify($this->extension->settings());
    }

    /**
     * Keep public catalog reads stable through short Shopify/network hiccups.
     * Fresh data is used for normal traffic; a successful older response is
     * retained for up to six hours and is only served when refresh fails.
     * Cart mutations deliberately never enter this cache.
     *
     * @param array<string,mixed> $variables
     * @return array<string,mixed>|\WP_Error
     */
    private function cached_storefront(string $scope, string $query, array $variables, int $fresh_seconds): array|\WP_Error {
        $settings = $this->extension->settings();
        $domain = (new Kodefy_Shopify($settings))->domain();
        $key = 'kodefy_catalog_' . md5($domain . '|' . $scope . '|' . wp_json_encode($variables));
        $cached = get_transient($key);
        $cached_data = is_array($cached) && is_array($cached['data'] ?? null)
            ? $cached['data']
            : null;
        if (
            $cached_data !== null
            && (int) ($cached['freshUntil'] ?? 0) >= time()
        ) return $cached_data;

        $data = $this->shopify()->storefront($query, $variables, self::buyer_ip());
        if (!is_wp_error($data)) {
            set_transient($key, [
                'freshUntil' => time() + max(5, $fresh_seconds),
                'data' => $data,
            ], 6 * HOUR_IN_SECONDS);
            return $data;
        }
        return $cached_data ?? $data;
    }

    /** @param array<string,mixed>|\WP_Error $data */
    private function respond(array|\WP_Error $data, string $field): \WP_REST_Response|\WP_Error {
        if (is_wp_error($data)) return $data;
        $value = $data[$field] ?? null;
        if ($value === null) return new \WP_Error('kodefy_not_found', 'O conteúdo solicitado não foi encontrado na Shopify.', ['status' => 404]);
        if (is_array($value)) {
            $errors = $value['userErrors'] ?? [];
            if (is_array($errors) && $errors) {
                $messages = [];
                foreach (array_slice($errors, 0, 5) as $error) {
                    if (is_array($error) && is_string($error['message'] ?? null)) $messages[] = $error['message'];
                }
                if ($messages) return new \WP_Error('kodefy_cart_rejected', implode(' ', $messages), ['status' => 422]);
            }
            $warnings = $value['warnings'] ?? [];
            if (is_array($warnings) && $warnings) {
                $messages = [];
                foreach (array_slice($warnings, 0, 5) as $warning) {
                    if (is_array($warning) && is_string($warning['message'] ?? null)) $messages[] = $warning['message'];
                }
                if ($messages) return new \WP_Error('kodefy_cart_warning', implode(' ', $messages), ['status' => 422]);
            }
            if (isset($value['cart']) && is_array($value['cart'])) $value = $value['cart'];
        }
        $response = new \WP_REST_Response(['ok' => true, 'data' => $value]);
        $response->header('Cache-Control', in_array($field, ['product', 'products', 'collection'], true) ? 'public, max-age=30' : 'no-store');
        return $response;
    }

    /** @param array<string,mixed> $variables @return array<string,mixed> */
    private function context(array $variables): array {
        $variables['country'] = $this->country();
        $language = strtoupper((string) ($this->extension->settings()['language'] ?? 'PT'));
        $variables['language'] = preg_match('/^[A-Z]{2}$/', $language) ? $language : 'PT';
        return $variables;
    }

    private function country(): string {
        $country = strtoupper((string) ($this->extension->settings()['country'] ?? 'BR'));
        return preg_match('/^[A-Z]{2}$/', $country) ? $country : 'BR';
    }

    private function gid(string $value, string $type): string {
        $value = trim($value);
        return preg_match('#^gid://shopify/' . preg_quote($type, '#') . '/[A-Za-z0-9._~?=&%:+-]+$#', $value) ? $value : '';
    }

    private function search_query(string $query): ?string {
        $query = trim(wp_strip_all_tags($query));
        if ($query === '') return null;
        return function_exists('mb_substr') ? mb_substr($query, 0, 180) : substr($query, 0, 180);
    }

    private function rate_limit(int $limit): bool|\WP_Error {
        $ip = self::buyer_ip() ?: 'unknown';
        $bucket = (int) floor(time() / 60);
        $key = 'kodefy_rate_' . md5($ip . '|' . $bucket);
        $count = (int) get_transient($key);
        if ($count >= $limit) return new \WP_Error('kodefy_rate_limit', 'Muitas solicitações. Tente novamente em instantes.', ['status' => 429]);
        set_transient($key, $count + 1, 70);
        return true;
    }

    private static function product_fields(): string {
        return <<<'GRAPHQL'
id
handle
title
vendor
productType
description
descriptionHtml
availableForSale
featuredImage { url altText width height }
images(first: 12) { nodes { url altText width height } }
options { id name values }
priceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
compareAtPriceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
variants(first: 100) {
  nodes {
    id
    title
    sku
    availableForSale
    quantityAvailable
    selectedOptions { name value }
    price { amount currencyCode }
    compareAtPrice { amount currencyCode }
    image { url altText width height }
  }
}
GRAPHQL;
    }

    private static function products_query(): string {
        return 'query KodefyProducts($first: Int!, $query: String, $sortKey: ProductSortKeys!, $reverse: Boolean!, $country: CountryCode!, $language: LanguageCode!) @inContext(country: $country, language: $language) { products(first: $first, query: $query, sortKey: $sortKey, reverse: $reverse) { nodes { ' . self::product_fields() . ' } pageInfo { hasNextPage endCursor } } }';
    }

    private static function builder_catalog_query(): string {
        return <<<'GRAPHQL'
query KodefyBuilderCatalog($first: Int!, $after: String, $collectionAfter: String, $country: CountryCode!, $language: LanguageCode!) @inContext(country: $country, language: $language) {
  shop { name paymentSettings { currencyCode } }
  products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
    nodes {
      id
      handle
      title
      vendor
      productType
      description
      descriptionHtml
      availableForSale
      featuredImage { url altText width height }
      images(first: 8) { nodes { url altText width height } }
      priceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
      compareAtPriceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
      variants(first: 25) {
        nodes {
          id
          title
          sku
          availableForSale
          quantityAvailable
          selectedOptions { name value }
          price { amount currencyCode }
          compareAtPrice { amount currencyCode }
          image { url altText width height }
        }
      }
      seo { title description }
    }
    pageInfo { hasNextPage endCursor }
  }
  collections(first: $first, after: $collectionAfter) {
    nodes {
      id
      handle
      title
      description
      descriptionHtml
      image { url altText width height }
      products(first: 24) { nodes { id handle } }
      seo { title description }
    }
    pageInfo { hasNextPage endCursor }
  }
}
GRAPHQL;
    }

    private static function product_query(): string {
        return 'query KodefyProduct($handle: String!, $country: CountryCode!, $language: LanguageCode!) @inContext(country: $country, language: $language) { product(handle: $handle) { ' . self::product_fields() . ' seo { title description } } }';
    }

    private static function collection_query(): string {
        return 'query KodefyCollection($handle: String!, $first: Int!, $country: CountryCode!, $language: LanguageCode!) @inContext(country: $country, language: $language) { collection(handle: $handle) { id handle title description descriptionHtml image { url altText width height } products(first: $first) { nodes { ' . self::product_fields() . ' } pageInfo { hasNextPage endCursor } } seo { title description } } }';
    }

    private static function cart_fields(): string {
        return <<<'GRAPHQL'
id
checkoutUrl
totalQuantity
note
cost {
  subtotalAmount { amount currencyCode }
  totalAmount { amount currencyCode }
  totalTaxAmount { amount currencyCode }
}
lines(first: 100) {
  nodes {
    id
    quantity
    cost { totalAmount { amount currencyCode } }
    merchandise {
      ... on ProductVariant {
        id
        title
        sku
        availableForSale
        quantityAvailable
        selectedOptions { name value }
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
        image { url altText width height }
        product { id handle title vendor }
      }
    }
  }
}
GRAPHQL;
    }

    private static function cart_query(): string {
        return 'query KodefyCart($id: ID!) { cart(id: $id) { ' . self::cart_fields() . ' } }';
    }

    private static function cart_create_mutation(): string {
        return 'mutation KodefyCartCreate($input: CartInput!) { cartCreate(input: $input) { cart { ' . self::cart_fields() . ' } userErrors { field message code } warnings { code message } } }';
    }

    private static function cart_add_mutation(): string {
        return 'mutation KodefyCartAdd($cartId: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ' . self::cart_fields() . ' } userErrors { field message code } warnings { code message } } }';
    }

    private static function cart_update_mutation(): string {
        return 'mutation KodefyCartUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) { cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { ' . self::cart_fields() . ' } userErrors { field message code } warnings { code message } } }';
    }

    private static function cart_remove_mutation(): string {
        return 'mutation KodefyCartRemove($cartId: ID!, $lineIds: [ID!]!) { cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ' . self::cart_fields() . ' } userErrors { field message code } warnings { code message } } }';
    }
}
