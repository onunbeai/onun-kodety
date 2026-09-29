<?php

namespace Kodefy\Shopify;

defined('ABSPATH') || exit;

/**
 * Resolve a provider checkout from an authoritative Shopify Storefront cart.
 *
 * This class deliberately does not read request payloads or persist settings.
 * Callers must first load the cart from Shopify and then pass that response to
 * resolve(). Prices, line items and checkout URLs are never accepted from the
 * browser by this service.
 */
final class Kodefy_Checkout {
    private const PROVIDERS = [
        'shopify' => ['native'],
        'appmax_shopify' => ['native'],
        'yampi' => ['link', 'session'],
        'cartpanda' => ['link', 'session'],
        'appmax' => ['link', 'session'],
        'custom' => ['link', 'session'],
    ];

    /**
     * Conservative provider-owned suffixes. A merchant checkout on a custom
     * domain must be explicitly added to checkout.allowedHosts.
     *
     * @var array<string,list<string>>
     */
    private const DEFAULT_ALLOWED_HOSTS = [
        'shopify' => ['myshopify.com', 'shopify.com', 'shop.app'],
        'appmax_shopify' => ['myshopify.com', 'shopify.com', 'shop.app'],
        'yampi' => ['yampi.com', 'yampi.com.br', 'dooki.com.br'],
        'cartpanda' => ['cartpanda.com', 'cartpanda.com.br', 'mycartpanda.com'],
        'appmax' => ['appmax.com', 'appmax.com.br'],
        'custom' => [],
    ];

    /** @var array<string,mixed> */
    private array $settings;

    /** @param array<string,mixed> $settings */
    public function __construct(array $settings) {
        $this->settings = $settings;
    }

    /**
     * Public provider capabilities, safe to expose in an authenticated admin
     * response. Credentials and configured endpoint values are not included.
     *
     * @return array<string,array{strategies:list<string>}>
     */
    public static function provider_catalog(): array {
        $catalog = [];
        foreach (self::PROVIDERS as $provider => $strategies) {
            $catalog[$provider] = ['strategies' => $strategies];
        }
        return $catalog;
    }

    /**
     * @param array<string,mixed> $cart Authoritative Storefront API cart.
     * @param array<string,mixed> $context Optional server-owned return URLs.
     *                                     Caller-provided idempotency keys are
     *                                     deliberately ignored: the session key
     *                                     is derived from the signed payload.
     * @return array<string,mixed>|\WP_Error
     */
    public function resolve(array $cart, array $context = []): array|\WP_Error {
        $normalized_cart = $this->normalize_cart($cart);
        if (is_wp_error($normalized_cart)) return $normalized_cart;

        $checkout = $this->checkout_settings();
        $provider = $this->provider_key($checkout['provider'] ?? 'shopify');
        if (!isset(self::PROVIDERS[$provider])) {
            return new \WP_Error(
                'kodefy_checkout_provider',
                'O provedor de checkout configurado não é suportado.',
                ['status' => 400]
            );
        }

        $provider_settings = $this->provider_settings($checkout, $provider);
        $resolved = $this->resolve_provider(
            $provider,
            $provider_settings,
            $normalized_cart,
            $context
        );
        if (!is_wp_error($resolved)) return $resolved;

        // Inventory failures describe the authoritative cart, not a provider
        // outage. Falling back here would let an external checkout rejection
        // silently continue with unavailable or over-quantity merchandise.
        if (in_array($resolved->get_error_code(), [
            'kodefy_checkout_item_unavailable',
            'kodefy_checkout_quantity_exceeded',
        ], true)) return $resolved;

        $fallback = $provider !== 'shopify'
            && $this->boolean($provider_settings['fallbackToShopify'] ?? false);
        if (!$fallback) return $resolved;

        $shopify_settings = $this->provider_settings($checkout, 'shopify');
        $native = $this->resolve_provider(
            'shopify',
            $shopify_settings,
            $normalized_cart,
            $context
        );
        if (is_wp_error($native)) {
            return new \WP_Error(
                'kodefy_checkout_fallback_failed',
                'O checkout externo falhou e o checkout nativo da Shopify não está disponível.',
                [
                    'status' => 502,
                    'provider' => $provider,
                    'cause' => $resolved->get_error_code(),
                    'fallbackCause' => $native->get_error_code(),
                ]
            );
        }

        $native['fallback'] = true;
        $native['requestedProvider'] = $provider;
        $native['fallbackReason'] = $resolved->get_error_code();
        return $native;
    }

    /** @return array<string,mixed> */
    private function checkout_settings(): array {
        $checkout = $this->settings['checkout'] ?? [];
        return is_array($checkout) ? $checkout : [];
    }

    /**
     * Accept both the preferred checkout.providers.<id> shape and a compact
     * checkout.<id> shape. Shared presentation/fallback fields remain usable
     * at checkout root, while provider-specific values take precedence.
     *
     * @param array<string,mixed> $checkout
     * @return array<string,mixed>
     */
    private function provider_settings(array $checkout, string $provider): array {
        $shared = $checkout;
        unset($shared['providers']);
        foreach (array_keys(self::PROVIDERS) as $provider_key) unset($shared[$provider_key]);

        $providers = is_array($checkout['providers'] ?? null)
            ? $checkout['providers']
            : [];
        $specific = is_array($providers[$provider] ?? null)
            ? $providers[$provider]
            : (is_array($checkout[$provider] ?? null) ? $checkout[$provider] : []);

        $merged = array_replace($shared, $specific);
        $shared_hosts = $this->allowed_host_values($shared['allowedHosts'] ?? []);
        $specific_hosts = $this->allowed_host_values($specific['allowedHosts'] ?? []);
        $merged['allowedHosts'] = array_values(array_unique(array_merge(
            $shared_hosts,
            $specific_hosts
        )));
        return $merged;
    }

    /**
     * @param array<string,mixed> $provider_settings
     * @param array<string,mixed> $cart
     * @param array<string,mixed> $context
     * @return array<string,mixed>|\WP_Error
     */
    private function resolve_provider(
        string $provider,
        array $provider_settings,
        array $cart,
        array $context
    ): array|\WP_Error {
        $strategy = in_array($provider, ['shopify', 'appmax_shopify'], true)
            ? 'native'
            : $this->strategy($provider_settings);
        if (!in_array($strategy, self::PROVIDERS[$provider], true)) {
            return new \WP_Error(
                'kodefy_checkout_strategy',
                'A estratégia configurada não é compatível com este provedor.',
                ['status' => 400, 'provider' => $provider]
            );
        }

        if ($strategy === 'native') {
            // checkoutUrl comes from the authoritative Storefront API. Shopify
            // may legitimately return the merchant's custom checkout domain,
            // so admit that exact host in addition to known Shopify domains.
            $native_settings = $provider_settings;
            $native_host = (string) wp_parse_url((string) $cart['checkout_url'], PHP_URL_HOST);
            $native_settings['allowedHosts'] = array_values(array_unique(array_merge(
                $this->allowed_host_values($provider_settings['allowedHosts'] ?? []),
                $native_host !== '' ? [$native_host] : []
            )));
            $url = $this->validated_provider_url(
                (string) $cart['checkout_url'],
                $provider,
                $native_settings,
                'URL de checkout da Shopify'
            );
        } else {
            $inventory = $this->validate_external_inventory($cart);
            if (is_wp_error($inventory)) return $inventory;
            $values = $this->placeholder_values($cart, $provider_settings, $context);
            if (is_wp_error($values)) return $values;
            if ($strategy === 'link') {
                $url = $this->resolve_link($provider, $provider_settings, $values);
            } else {
                $url = $this->resolve_session($provider, $provider_settings, $values, $cart);
            }
        }
        if (is_wp_error($url)) return $url;

        return [
            'provider' => $provider,
            'strategy' => $strategy,
            'url' => $url,
            'experience' => $this->experience($provider_settings['experience'] ?? 'redirect'),
            'overlaySelector' => $this->overlay_selector(
                $provider_settings['overlaySelector'] ?? '[data-kodefy-checkout-overlay]'
            ),
            'openInNewTab' => $this->boolean($provider_settings['openInNewTab'] ?? false),
            'fallback' => false,
        ];
    }

    /** @param array<string,mixed> $settings */
    private function strategy(array $settings): string {
        $strategy = sanitize_key((string) ($settings['strategy'] ?? ''));
        if ($strategy !== '') return $strategy;
        if (trim((string) ($settings['endpointUrl'] ?? '')) !== '') return 'session';
        return 'link';
    }

    /**
     * @param array<string,mixed> $settings
     * @param array<string,string> $values
     * @return string|\WP_Error
     */
    private function resolve_link(string $provider, array $settings, array $values): string|\WP_Error {
        $template = trim((string) ($settings['linkTemplate'] ?? ''));
        if ($template === '') {
            return new \WP_Error(
                'kodefy_checkout_link_template',
                'Informe o modelo de link do provedor de checkout.',
                ['status' => 400, 'provider' => $provider]
            );
        }
        if (strlen($template) > 8192 || preg_match('/[\x00-\x1F\x7F]/', $template)) {
            return new \WP_Error(
                'kodefy_checkout_link_template',
                'O modelo de link do checkout é inválido.',
                ['status' => 400, 'provider' => $provider]
            );
        }

        foreach ($values as $key => $value) {
            $encoded = rawurlencode($value);
            $template = str_replace(
                ['{{' . $key . '}}', '{' . $key . '}'],
                $encoded,
                $template
            );
        }
        if (preg_match('/\{\{?[A-Za-z0-9_]+\}?\}/', $template)) {
            return new \WP_Error(
                'kodefy_checkout_placeholder',
                'O modelo de link contém um placeholder não suportado.',
                ['status' => 400, 'provider' => $provider]
            );
        }

        return $this->validated_provider_url(
            $template,
            $provider,
            $settings,
            'Link do checkout'
        );
    }

    /**
     * @param array<string,mixed> $settings
     * @param array<string,string> $values
     * @param array<string,mixed> $cart
     * @return string|\WP_Error
     */
    private function resolve_session(
        string $provider,
        array $settings,
        array $values,
        array $cart
    ): string|\WP_Error {
        $endpoint = $this->validated_provider_url(
            (string) ($settings['endpointUrl'] ?? ''),
            $provider,
            $settings,
            'Endpoint de sessão'
        );
        if (is_wp_error($endpoint)) return $endpoint;

        $secret = $this->endpoint_secret($settings);
        if (is_wp_error($secret)) return $secret;

        $payload = [
            'provider' => $provider,
            'cart_id' => $values['cart_id'],
            'checkout_url' => $values['checkout_url'],
            'shop_domain' => $values['shop_domain'],
            'return_url' => $values['return_url'],
            'cancel_url' => $values['cancel_url'],
            'currency' => $values['currency'],
            'total' => $values['total'],
            'items_b64' => $values['items_b64'],
            'items' => $cart['items'],
        ];
        $body = wp_json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($body)) {
            return new \WP_Error(
                'kodefy_checkout_session_payload',
                'Não foi possível preparar os dados da sessão de checkout.',
                ['status' => 500, 'provider' => $provider]
            );
        }

        // Bind idempotency to exactly what the provider receives. The browser
        // cannot force two different authoritative carts to share a session by
        // reusing an Idempotency-Key header.
        $idempotency_key = $this->idempotency_key($provider, $body);
        $signature = hash_hmac('sha256', $body, $secret);
        $timeout = max(5, min(30, (int) ($settings['timeout'] ?? 15)));
        $response = wp_safe_remote_post($endpoint, [
            'timeout' => $timeout,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'limit_response_size' => 1024 * 1024,
            'headers' => [
                'Accept' => 'application/json',
                'Content-Type' => 'application/json',
                'Authorization' => 'Bearer ' . $secret,
                'X-Kodefy-Signature' => 'sha256=' . $signature,
                'Idempotency-Key' => $idempotency_key,
            ],
            'body' => $body,
            'data_format' => 'body',
        ]);
        if (is_wp_error($response)) {
            return new \WP_Error(
                'kodefy_checkout_session_unreachable',
                'Não foi possível acessar o provedor de checkout.',
                ['status' => 502, 'provider' => $provider]
            );
        }

        $status = (int) wp_remote_retrieve_response_code($response);
        if ($status < 200 || $status >= 300) {
            return new \WP_Error(
                'kodefy_checkout_session_http',
                sprintf('O provedor de checkout recusou a criação da sessão (HTTP %d).', $status),
                ['status' => 502, 'provider' => $provider, 'providerStatus' => $status]
            );
        }

        $decoded = json_decode((string) wp_remote_retrieve_body($response), true);
        if (!is_array($decoded)) {
            return new \WP_Error(
                'kodefy_checkout_session_response',
                'O provedor retornou uma resposta de sessão inválida.',
                ['status' => 502, 'provider' => $provider]
            );
        }
        $data = is_array($decoded['data'] ?? null) ? $decoded['data'] : [];
        $checkout_url = trim((string) (
            $decoded['url']
            ?? $decoded['checkoutUrl']
            ?? $data['url']
            ?? $data['checkoutUrl']
            ?? ''
        ));
        if ($checkout_url === '') {
            return new \WP_Error(
                'kodefy_checkout_session_url',
                'O provedor não retornou url ou checkoutUrl para a sessão.',
                ['status' => 502, 'provider' => $provider]
            );
        }

        return $this->validated_provider_url(
            $checkout_url,
            $provider,
            $settings,
            'URL retornada pelo provedor'
        );
    }

    /**
     * @param array<string,mixed> $settings
     * @return string|\WP_Error
     */
    private function endpoint_secret(array $settings): string|\WP_Error {
        $stored = trim((string) ($settings['endpointSecret'] ?? ''));
        if ($stored === '') {
            return new \WP_Error(
                'kodefy_checkout_endpoint_secret',
                'A estratégia de sessão exige um segredo criptografado do endpoint.',
                ['status' => 400]
            );
        }
        if (!class_exists(Kodefy_Crypto::class)) {
            return new \WP_Error(
                'kodefy_checkout_crypto',
                'O serviço de criptografia do Kodefy não está disponível.',
                ['status' => 500]
            );
        }
        $secret = Kodefy_Crypto::decrypt($stored);
        if ($secret === '') {
            return new \WP_Error(
                'kodefy_checkout_endpoint_secret',
                'O segredo do endpoint não pôde ser aberto. Salve a credencial novamente.',
                ['status' => 400]
            );
        }
        return $secret;
    }

    /**
     * @param array<string,mixed> $cart
     * @return array<string,mixed>|\WP_Error
     */
    private function normalize_cart(array $cart): array|\WP_Error {
        $cart_id = trim((string) ($cart['id'] ?? ''));
        if (!preg_match('#^gid://shopify/Cart/[A-Za-z0-9._~?=&%:+-]+$#', $cart_id)) {
            return new \WP_Error(
                'kodefy_checkout_cart_id',
                'O carrinho Shopify informado é inválido.',
                ['status' => 400]
            );
        }

        $checkout_url = trim((string) ($cart['checkoutUrl'] ?? $cart['checkout_url'] ?? ''));
        $cost = is_array($cart['cost'] ?? null) ? $cart['cost'] : [];
        $total_money = is_array($cost['totalAmount'] ?? null) ? $cost['totalAmount'] : [];
        $total = trim((string) ($total_money['amount'] ?? ''));
        if (!preg_match('/^\d+(?:\.\d{1,6})?$/', $total)) {
            return new \WP_Error(
                'kodefy_checkout_cart_total',
                'A Shopify não retornou um total válido para o carrinho.',
                ['status' => 422]
            );
        }
        $currency = strtoupper(trim((string) ($total_money['currencyCode'] ?? '')));
        if (!preg_match('/^[A-Z]{3}$/', $currency)) {
            return new \WP_Error(
                'kodefy_checkout_cart_currency',
                'A Shopify não retornou uma moeda válida para o carrinho.',
                ['status' => 422]
            );
        }

        $line_container = is_array($cart['lines'] ?? null) ? $cart['lines'] : [];
        $raw_lines = is_array($line_container['nodes'] ?? null)
            ? $line_container['nodes']
            : [];
        $items = [];
        foreach (array_slice($raw_lines, 0, 100) as $line) {
            if (!is_array($line)) continue;
            $quantity = (int) ($line['quantity'] ?? 0);
            if ($quantity <= 0) continue;
            $merchandise = is_array($line['merchandise'] ?? null) ? $line['merchandise'] : [];
            $variant_id = trim((string) ($merchandise['id'] ?? ''));
            if (!preg_match('#^gid://shopify/ProductVariant/[A-Za-z0-9._~?=&%:+-]+$#', $variant_id)) {
                return new \WP_Error(
                    'kodefy_checkout_cart_line',
                    'O carrinho contém uma variante Shopify inválida.',
                    ['status' => 422]
                );
            }
            $product = is_array($merchandise['product'] ?? null) ? $merchandise['product'] : [];
            $line_cost = is_array($line['cost'] ?? null) ? $line['cost'] : [];
            $line_total = is_array($line_cost['totalAmount'] ?? null) ? $line_cost['totalAmount'] : [];
            $available_for_sale = array_key_exists('availableForSale', $merchandise)
                ? filter_var($merchandise['availableForSale'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE)
                : null;
            $quantity_available = is_numeric($merchandise['quantityAvailable'] ?? null)
                ? max(0, (int) $merchandise['quantityAvailable'])
                : null;
            $options = [];
            foreach (array_slice((array) ($merchandise['selectedOptions'] ?? []), 0, 20) as $option) {
                if (!is_array($option)) continue;
                $options[] = [
                    'name' => $this->bounded_text($option['name'] ?? '', 100),
                    'value' => $this->bounded_text($option['value'] ?? '', 191),
                ];
            }
            $items[] = [
                'variant_id' => $variant_id,
                'sku' => $this->bounded_text($merchandise['sku'] ?? '', 191),
                'quantity' => max(1, min(9999, $quantity)),
                'title' => $this->bounded_text($merchandise['title'] ?? '', 255),
                'product_title' => $this->bounded_text($product['title'] ?? '', 255),
                'product_handle' => sanitize_title((string) ($product['handle'] ?? '')),
                'available_for_sale' => $available_for_sale,
                'quantity_available' => $quantity_available,
                'options' => $options,
                'line_total' => preg_match('/^\d+(?:\.\d{1,6})?$/', (string) ($line_total['amount'] ?? ''))
                    ? (string) $line_total['amount']
                    : '',
                'currency' => preg_match('/^[A-Z]{3}$/', strtoupper((string) ($line_total['currencyCode'] ?? '')))
                    ? strtoupper((string) $line_total['currencyCode'])
                    : $currency,
            ];
        }
        if (!$items) {
            return new \WP_Error(
                'kodefy_checkout_cart_empty',
                'O carrinho está vazio e não pode iniciar um checkout.',
                ['status' => 409]
            );
        }

        return [
            'id' => $cart_id,
            'checkout_url' => $checkout_url,
            'currency' => $currency,
            'total' => $total,
            'items' => $items,
        ];
    }

    /**
     * External providers do not perform Shopify's native inventory validation,
     * so reject stale cart lines before creating a link or remote session.
     * Quantities are aggregated by variant because Shopify can keep the same
     * variant in separate lines when attributes differ.
     *
     * @param array<string,mixed> $cart Normalized authoritative cart.
     * @return bool|\WP_Error
     */
    private function validate_external_inventory(array $cart): bool|\WP_Error {
        /** @var array<string,array{quantity:int,available:?int,label:string}> $variants */
        $variants = [];
        foreach ((array) ($cart['items'] ?? []) as $item) {
            if (!is_array($item)) continue;
            $variant_id = (string) ($item['variant_id'] ?? '');
            $label = trim((string) ($item['product_title'] ?? ''));
            $variant_title = trim((string) ($item['title'] ?? ''));
            if ($variant_title !== '' && !in_array(strtolower($variant_title), ['default title', 'título padrão'], true)) {
                $label .= ($label !== '' ? ' — ' : '') . $variant_title;
            }
            if ($label === '') $label = 'Item do carrinho';

            if (($item['available_for_sale'] ?? null) !== true) {
                return new \WP_Error(
                    'kodefy_checkout_item_unavailable',
                    sprintf('A Shopify não confirmou disponibilidade para “%s”. Atualize o carrinho e tente novamente.', $label),
                    ['status' => 422, 'variantId' => $variant_id]
                );
            }

            if (!isset($variants[$variant_id])) {
                $variants[$variant_id] = [
                    'quantity' => 0,
                    'available' => null,
                    'label' => $label,
                ];
            }
            $variants[$variant_id]['quantity'] += max(0, (int) ($item['quantity'] ?? 0));
            $available = $item['quantity_available'] ?? null;
            if (is_int($available)) {
                $current = $variants[$variant_id]['available'];
                $variants[$variant_id]['available'] = $current === null
                    ? $available
                    : min($current, $available);
            }
        }

        foreach ($variants as $variant_id => $inventory) {
            if ($inventory['available'] === null || $inventory['quantity'] <= $inventory['available']) continue;
            return new \WP_Error(
                'kodefy_checkout_quantity_exceeded',
                sprintf(
                    'A quantidade solicitada de “%s” excede o estoque disponível (%d solicitada, %d disponível).',
                    $inventory['label'],
                    $inventory['quantity'],
                    $inventory['available']
                ),
                [
                    'status' => 422,
                    'variantId' => $variant_id,
                    'requestedQuantity' => $inventory['quantity'],
                    'availableQuantity' => $inventory['available'],
                ]
            );
        }
        return true;
    }

    /**
     * @param array<string,mixed> $cart
     * @param array<string,mixed> $settings
     * @param array<string,mixed> $context
     * @return array<string,string>|\WP_Error
     */
    private function placeholder_values(
        array $cart,
        array $settings,
        array $context
    ): array|\WP_Error {
        $shop_domain = $this->normalize_host((string) ($this->settings['shopDomain'] ?? ''));
        if ($shop_domain === '') {
            return new \WP_Error(
                'kodefy_checkout_shop_domain',
                'O domínio permanente da Shopify não está configurado.',
                ['status' => 400]
            );
        }

        $home = function_exists('home_url') ? home_url('/') : '';
        $return_url = $this->same_site_https_url(
            $context['returnUrl']
                ?? $context['return_url']
                ?? $settings['returnUrl']
                ?? $settings['return_url']
                ?? $home,
            'URL de retorno'
        );
        if (is_wp_error($return_url)) return $return_url;
        $cancel_url = $this->same_site_https_url(
            $context['cancelUrl']
                ?? $context['cancel_url']
                ?? $settings['cancelUrl']
                ?? $settings['cancel_url']
                ?? $return_url,
            'URL de cancelamento'
        );
        if (is_wp_error($cancel_url)) return $cancel_url;

        $items_json = wp_json_encode(
            $cart['items'],
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        );
        if (!is_string($items_json) || strlen($items_json) > 256 * 1024) {
            return new \WP_Error(
                'kodefy_checkout_items',
                'O carrinho excede o tamanho permitido para o checkout.',
                ['status' => 413]
            );
        }

        return [
            'cart_id' => (string) $cart['id'],
            'checkout_url' => (string) $cart['checkout_url'],
            'shop_domain' => $shop_domain,
            'return_url' => $return_url,
            'cancel_url' => $cancel_url,
            'currency' => (string) $cart['currency'],
            'total' => (string) $cart['total'],
            'items_b64' => base64_encode($items_json),
        ];
    }

    /**
     * @param array<string,mixed> $settings
     * @return string|\WP_Error
     */
    private function validated_provider_url(
        string $value,
        string $provider,
        array $settings,
        string $label
    ): string|\WP_Error {
        $value = trim($value);
        if ($value === '' || strlen($value) > 8192 || preg_match('/[\x00-\x1F\x7F]/', $value)) {
            return new \WP_Error(
                'kodefy_checkout_url',
                $label . ' não é uma URL HTTPS válida.',
                ['status' => 400, 'provider' => $provider]
            );
        }
        $parsed = wp_parse_url($value);
        if (
            !is_array($parsed)
            || strtolower((string) ($parsed['scheme'] ?? '')) !== 'https'
            || isset($parsed['user'])
            || isset($parsed['pass'])
            || (isset($parsed['port']) && (int) $parsed['port'] !== 443)
        ) {
            return new \WP_Error(
                'kodefy_checkout_url',
                $label . ' deve usar HTTPS, sem credenciais ou porta personalizada.',
                ['status' => 400, 'provider' => $provider]
            );
        }
        $host = $this->normalize_host((string) ($parsed['host'] ?? ''));
        if ($host === '') {
            return new \WP_Error(
                'kodefy_checkout_url_host',
                $label . ' possui um host inválido.',
                ['status' => 400, 'provider' => $provider]
            );
        }

        $allowed = $this->allowed_hosts($provider, $settings);
        if (!$this->host_is_allowed($host, $allowed)) {
            return new \WP_Error(
                'kodefy_checkout_url_host',
                $label . ' não pertence à lista de hosts permitidos.',
                ['status' => 400, 'provider' => $provider, 'host' => $host]
            );
        }
        $safe = esc_url_raw($value, ['https']);
        if ($safe === '') {
            return new \WP_Error(
                'kodefy_checkout_url',
                $label . ' não pôde ser validada.',
                ['status' => 400, 'provider' => $provider]
            );
        }
        return $safe;
    }

    /** @param array<string,mixed> $settings @return list<string> */
    private function allowed_hosts(string $provider, array $settings): array {
        $hosts = self::DEFAULT_ALLOWED_HOSTS[$provider] ?? [];
        $hosts = array_merge($hosts, $this->allowed_host_values($settings['allowedHosts'] ?? []));
        if (in_array($provider, ['shopify', 'appmax_shopify'], true)) {
            $hosts[] = (string) ($this->settings['shopDomain'] ?? '');
        }
        $normalized = [];
        foreach ($hosts as $host) {
            $host = $this->normalize_allowed_host((string) $host);
            if ($host !== '') $normalized[$host] = $host;
        }
        return array_values($normalized);
    }

    /** @return list<string> */
    private function allowed_host_values(mixed $value): array {
        if (is_string($value)) {
            $value = preg_split('/[,\s]+/', $value) ?: [];
        }
        if (!is_array($value)) return [];
        $output = [];
        foreach (array_slice($value, 0, 100) as $host) {
            if (!is_scalar($host)) continue;
            $normalized = $this->normalize_allowed_host((string) $host);
            if ($normalized !== '') $output[$normalized] = $normalized;
        }
        return array_values($output);
    }

    private function normalize_allowed_host(string $value): string {
        $value = strtolower(trim($value));
        if (str_contains($value, '://')) {
            $value = (string) wp_parse_url($value, PHP_URL_HOST);
        }
        $value = preg_replace('/^\*\./', '', $value) ?? '';
        $value = ltrim(rtrim($value, '.'), '.');
        $host = $this->normalize_host($value);
        if (in_array($host, ['com', 'net', 'org', 'com.br', 'net.br', 'org.br'], true)) return '';
        return $host;
    }

    private function normalize_host(string $value): string {
        $value = strtolower(trim($value));
        $value = preg_replace('~^https?://~', '', $value) ?? '';
        $value = trim(explode('/', $value, 2)[0], '.');
        if (function_exists('idn_to_ascii')) {
            // The one-argument form also works on PHP builds where intl is
            // present but legacy IDNA constants are not exposed.
            $ascii = idn_to_ascii($value);
            if (is_string($ascii)) $value = strtolower($ascii);
        }
        if (
            $value === ''
            || strlen($value) > 253
            || filter_var($value, FILTER_VALIDATE_IP)
            || !str_contains($value, '.')
            || !preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $value)
        ) return '';
        return $value;
    }

    /** @param list<string> $allowed */
    private function host_is_allowed(string $host, array $allowed): bool {
        foreach ($allowed as $suffix) {
            if ($host === $suffix || str_ends_with($host, '.' . $suffix)) return true;
        }
        return false;
    }

    private function same_site_https_url(mixed $value, string $label): string|\WP_Error {
        $url = trim((string) $value);
        $parsed = wp_parse_url($url);
        $home = wp_parse_url(function_exists('home_url') ? home_url('/') : '');
        $host = is_array($parsed) ? $this->normalize_host((string) ($parsed['host'] ?? '')) : '';
        $home_host = is_array($home) ? $this->normalize_host((string) ($home['host'] ?? '')) : '';
        if (
            !is_array($parsed)
            || strtolower((string) ($parsed['scheme'] ?? '')) !== 'https'
            || $host === ''
            || $home_host === ''
            || !hash_equals($home_host, $host)
            || isset($parsed['user'])
            || isset($parsed['pass'])
            || (isset($parsed['port']) && (int) $parsed['port'] !== 443)
        ) {
            return new \WP_Error(
                'kodefy_checkout_return_url',
                $label . ' deve ser uma URL HTTPS deste site.',
                ['status' => 400]
            );
        }
        $safe = esc_url_raw($url, ['https']);
        return $safe !== ''
            ? $safe
            : new \WP_Error(
                'kodefy_checkout_return_url',
                $label . ' é inválida.',
                ['status' => 400]
            );
    }

    private function idempotency_key(string $provider, string $authoritative_payload): string {
        return 'kfy_' . hash('sha256', $provider . "\n" . $authoritative_payload);
    }

    private function provider_key(mixed $value): string {
        return sanitize_key(strtolower(trim((string) $value)));
    }

    private function experience(mixed $value): string {
        $value = sanitize_key((string) $value);
        return in_array($value, ['redirect', 'overlay', 'embedded'], true)
            ? $value
            : 'redirect';
    }

    private function overlay_selector(mixed $value): string {
        $value = trim((string) $value);
        if (
            $value === ''
            || strlen($value) > 255
            || preg_match('/[{};<>\x00-\x1F\x7F]/', $value)
        ) return '[data-kodefy-checkout-overlay]';
        return $value;
    }

    private function boolean(mixed $value): bool {
        if (is_bool($value)) return $value;
        if (is_int($value) || is_float($value)) return (int) $value === 1;
        return in_array(strtolower(trim((string) $value)), ['1', 'true', 'yes', 'on'], true);
    }

    private function bounded_text(mixed $value, int $length): string {
        $value = sanitize_text_field((string) $value);
        return function_exists('mb_substr')
            ? mb_substr($value, 0, $length)
            : substr($value, 0, $length);
    }
}
