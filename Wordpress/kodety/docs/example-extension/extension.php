<?php
/**
 * ACME Example — minimal Onun Kodety extension.
 *
 * The entrypoint is loaded by Onun Kodety only while the extension is active.
 */

namespace Kodety\ExtensionExample;

defined('ABSPATH') || exit;

const SLUG = 'acme-example';

if (!function_exists('\kodety_extension')) return;

$extension = \kodety_extension();
if (!$extension || $extension->slug() !== SLUG) return;
$storage = $extension->storage();

/**
 * Supply defaults without overwriting settings restored after reinstallation.
 *
 */
function activate(\Kodety_Extension_Storage $storage): void {
    if (!$storage->has('message')) $storage->set('message', 'Extensão ACME ativa.');
}

/**
 * Deactivation is reversible and must preserve data.
 *
 */
function deactivate(): void {
    // Cancel only temporary jobs or listeners owned by this extension.
}

add_action(
    'kodety_extension_activate_' . SLUG,
    static fn(): mixed => activate($storage)
);
add_action('kodety_extension_deactivate_' . SLUG, __NAMESPACE__ . '\\deactivate');

/**
 * Render a deliberately small public integration.
 *
 * Usage: [kodety_acme_example_message]
 */
function render_message(\Kodety_Extension_Storage $storage): string {
    $message = (string) $storage->get('message', 'Extensão ACME ativa.');
    return '<p class="kodety-acme-example">' . esc_html($message) . '</p>';
}

$extension->frontend()->shortcode(
    'message',
    static fn(): string => render_message($storage)
);
