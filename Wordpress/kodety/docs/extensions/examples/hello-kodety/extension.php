<?php
/**
 * Hello Onun Kodety — installable Public Extension API v1 example.
 */

namespace Kodety\Examples\Hello;

defined('ABSPATH') || exit;

$extension = \kodety_extension();
if (!$extension || $extension->slug() !== 'hello-kodety') return;

$storage = $extension->storage();
$auth = $extension->auth();
$ui = $extension->ui();

add_action('kodety_extension_activate_hello-kodety', static function () use ($storage): void {
    if (!$storage->has('message')) $storage->set('message', 'Hello, Onun Kodety!');
});

$extension->admin()->register_page('settings', [
    'title' => 'Hello Onun Kodety',
    'menu_title' => 'Hello Onun Kodety',
    'capability' => 'manage_options',
    'callback' => static function () use ($storage, $auth, $ui): string {
        $notice = '';
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
            $nonce = isset($_POST['_hello_nonce'])
                ? (string) wp_unslash($_POST['_hello_nonce'])
                : '';
            if (!$auth->verify_nonce($nonce, 'save-message') || !$auth->can('manage_options')) {
                return '<div class="wrap"><h1>Hello Onun Kodety</h1>'
                    . $ui->notice('Request não autorizado.', 'error')
                    . '</div>';
            }
            $message = isset($_POST['message'])
                ? sanitize_text_field((string) wp_unslash($_POST['message']))
                : '';
            if ($message === '') {
                $notice = $ui->notice('Informe uma mensagem.', 'warning');
            } elseif ($storage->set('message', $message)) {
                $notice = $ui->notice('Mensagem salva.', 'success');
            } else {
                $notice = $ui->notice('Não foi possível salvar.', 'error');
            }
        }

        $message = (string) $storage->get('message', 'Hello, Onun Kodety!');
        $nonce = $auth->create_nonce('save-message');
        return '<div class="wrap"><h1>Hello Onun Kodety</h1>'
            . $notice
            . '<p>Este valor usa o storage isolado da extensão.</p>'
            . '<form method="post">'
            . '<input type="hidden" name="_hello_nonce" value="' . esc_attr($nonce) . '">'
            . '<label for="hello-message"><strong>Mensagem</strong></label><br>'
            . '<input class="regular-text" id="hello-message" name="message" value="'
            . esc_attr($message)
            . '"> '
            . '<button class="button button-primary" type="submit">Salvar</button>'
            . '</form></div>';
    },
]);

$extension->routes()->register('message', [
    'methods' => 'GET',
    'permission' => ['capability' => 'manage_options'],
    'callback' => static fn(): array => [
        'message' => (string) $storage->get('message', 'Hello, Onun Kodety!'),
    ],
]);

$extension->frontend()->shortcode(
    'message',
    static fn(): string => '<p class="hello-kodety">'
        . esc_html((string) $storage->get('message', 'Hello, Onun Kodety!'))
        . '</p>'
);

