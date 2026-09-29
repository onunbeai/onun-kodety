<?php
/**
 * Kodefy — Shopify commerce for Kodety.
 *
 * The visual storefront remains in WordPress/Kodety. Shopify is the source of
 * truth for products, variants, availability, carts and checkout.
 */

namespace Kodefy\Shopify;

defined('ABSPATH') || exit;

const SLUG = 'kodefy-shopify';
const VERSION = '1.3.3';
const API_VERSION = '2026-07';

if (!class_exists('\Kodety_Extensions')) return;

require_once __DIR__ . '/includes/class-kodefy-crypto.php';
require_once __DIR__ . '/includes/class-kodefy-shopify.php';
require_once __DIR__ . '/includes/class-kodefy-checkout.php';
require_once __DIR__ . '/includes/class-kodefy-theme-exporter.php';
require_once __DIR__ . '/includes/class-kodefy-storefront.php';
require_once __DIR__ . '/includes/class-kodefy-extension.php';

/** @param array<string,mixed> $extension */
function activate(array $extension, \Kodety_Extensions $manager): void {
    $settings = $manager->get_settings(SLUG, []);
    $defaults = [
        'schemaVersion' => 2,
        'shopDomain' => '',
        'storefrontToken' => '',
        'storefrontTokenType' => 'public',
        'apiVersion' => API_VERSION,
        'country' => 'BR',
        'language' => 'PT',
        'routes' => [
            'shop' => '/shop/',
            'product' => '/products/',
            'collection' => '/collections/',
            'cart' => '/cart/',
            'search' => '/search/',
            'wishlist' => '/wishlist/',
        ],
        'templates' => [
            'product' => 'product',
            'collection' => 'collection',
        ],
        'checkout' => [
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
            'cancelPath' => '/cart/',
        ],
    ];
    $manager->update_settings(SLUG, array_replace_recursive($defaults, $settings));
}

/** @param array<string,mixed> $extension */
function deactivate(array $extension, \Kodety_Extensions $manager): void {
    Kodefy_Extension::clear_scheduled_exports();
}

add_action('kodety_extension_activate_' . SLUG, __NAMESPACE__ . '\\activate', 10, 2);
add_action('kodety_extension_deactivate_' . SLUG, __NAMESPACE__ . '\\deactivate', 10, 2);

Kodefy_Extension::instance()->boot();
