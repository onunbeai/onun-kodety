<?php

defined('ABSPATH') || exit;

$zipPath = $args[0] ?? '';
if ($zipPath === '' || !is_file($zipPath)) {
    WP_CLI::error('Informe um ZIP de projeto válido.');
}

$admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
if (!$admins) {
    WP_CLI::error('Nenhum administrador disponível para importar.');
}
wp_set_current_user((int) $admins[0]);

$plugin = Kodety_Plugin::instance();
$stageImport = new ReflectionMethod($plugin, 'stage_builder_import');
$stageImport->invoke($plugin, $zipPath, basename($zipPath));

WP_CLI::log((string) wp_json_encode([
    'success' => true,
    'projectName' => get_option('kodety_project_name', ''),
    'workspaceRevision' => (int) get_option('kodety_workspace_revision', 0),
    'originalName' => get_option('kodety_original_name', ''),
], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
