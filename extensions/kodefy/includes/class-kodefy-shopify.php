<?php

namespace Kodefy\Shopify;

defined('ABSPATH') || exit;

final class Kodefy_Shopify {
    private const REQUEST_TIMEOUT = 15;
    private const RESPONSE_SIZE_LIMIT = 2 * 1024 * 1024;

    /** @var array<string,mixed> */
    private array $settings;

    /** @param array<string,mixed> $settings */
    public function __construct(array $settings) {
        $this->settings = $settings;
    }

    public function configured(bool $admin = false): bool {
        if ($this->domain() === '') return false;
        $key = $admin ? 'adminToken' : 'storefrontToken';
        return $this->token($key) !== '';
    }

    public function domain(): string {
        $stored = $this->settings['shopDomain'] ?? '';
        if (!is_scalar($stored)) return '';
        $domain = $this->normalized_domain((string) $stored);
        return $this->is_valid_domain($domain) ? $domain : '';
    }

    public function storefront(string $query, array $variables = [], string $buyer_ip = ''): array|\WP_Error {
        $domain = $this->request_domain();
        if (is_wp_error($domain)) return $domain;
        $token = $this->token('storefrontToken');
        if ($domain === '' || $token === '') {
            return new \WP_Error('kodefy_not_configured', 'Conecte uma loja Shopify nas configurações do Kodefy.', ['status' => 503]);
        }
        $token_type = ($this->settings['storefrontTokenType'] ?? 'public') === 'private' ? 'private' : 'public';
        $headers = ['Content-Type' => 'application/json'];
        if ($token_type === 'private') {
            $headers['Shopify-Storefront-Private-Token'] = $token;
            if ($buyer_ip !== '' && filter_var($buyer_ip, FILTER_VALIDATE_IP)) {
                $headers['Shopify-Storefront-Buyer-IP'] = $buyer_ip;
            }
        } else {
            $headers['X-Shopify-Storefront-Access-Token'] = $token;
        }
        return $this->graphql(
            'https://' . $domain . '/api/' . $this->api_version() . '/graphql.json',
            $headers,
            $query,
            $variables
        );
    }

    public function admin(string $query, array $variables = []): array|\WP_Error {
        $domain = $this->request_domain();
        if (is_wp_error($domain)) return $domain;
        $token = $this->token('adminToken');
        if ($domain === '' || $token === '') {
            return new \WP_Error('kodefy_admin_not_configured', 'Informe um Admin API token com acesso a temas.', ['status' => 503]);
        }
        return $this->graphql(
            'https://' . $domain . '/admin/api/' . $this->api_version() . '/graphql.json',
            [
                'Content-Type' => 'application/json',
                'X-Shopify-Access-Token' => $token,
            ],
            $query,
            $variables
        );
    }

    public function verify_storefront(): array|\WP_Error {
        return $this->storefront(
            'query KodefyConnection { shop { name primaryDomain { url } paymentSettings { currencyCode } } }',
            [],
            Kodefy_Storefront::buyer_ip()
        );
    }

    private function graphql(string $url, array $headers, string $query, array $variables): array|\WP_Error {
        $response = wp_safe_remote_post($url, [
            'timeout' => self::REQUEST_TIMEOUT,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'limit_response_size' => self::RESPONSE_SIZE_LIMIT,
            'headers' => $headers,
            'body' => wp_json_encode(['query' => $query, 'variables' => (object) $variables]),
            'data_format' => 'body',
        ]);
        if (is_wp_error($response)) {
            return new \WP_Error('kodefy_shopify_unreachable', 'Não foi possível acessar a Shopify.', ['status' => 502]);
        }
        $status = (int) wp_remote_retrieve_response_code($response);
        $decoded = json_decode((string) wp_remote_retrieve_body($response), true);
        if ($status < 200 || $status >= 300 || !is_array($decoded)) {
            return new \WP_Error('kodefy_shopify_response', 'A Shopify retornou uma resposta inválida.', ['status' => 502]);
        }
        $errors = $decoded['errors'] ?? null;
        if (array_key_exists('errors', $decoded) && $errors !== null && $errors !== []) {
            $messages = [];
            foreach (is_array($errors) ? array_slice($errors, 0, 5) : [] as $error) {
                if (is_array($error) && is_string($error['message'] ?? null)) {
                    $message = trim($error['message']);
                    if ($message !== '') $messages[] = $message;
                }
            }
            return new \WP_Error(
                'kodefy_shopify_graphql',
                $messages ? implode(' ', $messages) : 'A Shopify recusou a operação.',
                ['status' => 422]
            );
        }
        if (!array_key_exists('data', $decoded) || !is_array($decoded['data'])) {
            return new \WP_Error(
                'kodefy_shopify_graphql_data',
                'A Shopify respondeu sem os dados esperados. Tente novamente.',
                ['status' => 502]
            );
        }
        return $decoded['data'];
    }

    private function normalized_domain(string $stored): string {
        $domain = strtolower(trim($stored));
        $domain = preg_replace('~^https?://~', '', $domain) ?? '';
        return trim($domain, '/');
    }

    private function is_valid_domain(string $domain): bool {
        return strlen($domain) <= 253
            && preg_match('/\A[a-z0-9][a-z0-9-]*\.myshopify\.com\z/', $domain) === 1;
    }

    private function request_domain(): string|\WP_Error {
        $stored = $this->settings['shopDomain'] ?? '';
        if (!is_scalar($stored)) {
            return new \WP_Error(
                'kodefy_shop_domain_invalid',
                'O domínio Shopify configurado é inválido. Use o domínio permanente no formato nome.myshopify.com.',
                ['status' => 503]
            );
        }
        $stored = trim((string) $stored);
        $domain = $this->normalized_domain($stored);
        if ($stored !== '' && !$this->is_valid_domain($domain)) {
            return new \WP_Error(
                'kodefy_shop_domain_invalid',
                'O domínio Shopify configurado é inválido. Use o domínio permanente no formato nome.myshopify.com.',
                ['status' => 503]
            );
        }
        return $domain;
    }

    private function api_version(): string {
        $version = (string) ($this->settings['apiVersion'] ?? API_VERSION);
        return preg_match('/^20\d{2}-(?:01|04|07|10)$/', $version) ? $version : API_VERSION;
    }

    private function token(string $key): string {
        $stored = (string) ($this->settings[$key] ?? '');
        return Kodefy_Crypto::decrypt($stored);
    }
}
