<?php

defined('ABSPATH') || exit;

$zip_path = $args[0] ?? '';
if ($zip_path === '' || !is_file($zip_path)) {
    WP_CLI::error('Informe um ZIP de projeto válido.');
}

$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
if (!$admins) WP_CLI::error('Nenhum administrador disponível para publicar.');
wp_set_current_user((int) $admins[0]);

$request = new WP_REST_Request('POST', '/kodety/v1/publish');
$request->set_body((string) file_get_contents($zip_path));
$request->set_param('optimizations', get_option('kodety_optimization_settings', []));
$response = rest_do_request($request);
if (is_wp_error($response)) WP_CLI::error($response->get_error_message());

$data = $response->get_data();
if ($response->get_status() >= 400 || empty($data['success'])) {
    WP_CLI::error((string) ($data['message'] ?? 'A publicação não foi concluída.'));
}

WP_CLI::log((string) wp_json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
