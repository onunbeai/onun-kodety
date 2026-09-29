<?php
/**
 * Casca do construtor de email.
 *
 * Carrega apenas o bundle `Wordpress/email-editor/main.tsx`. O editor de sites
 * não é tocado aqui: são duas entradas independentes no mesmo manifest.
 */

defined('ABSPATH') || exit;

$admin_ui_i18n_service = class_exists('Kodety_Admin_I18n') ? Kodety_Admin_I18n::instance() : null;
$admin_ui_translate = static fn(string $source): string => $admin_ui_i18n_service
    ? $admin_ui_i18n_service->translate($source)
    : $source;
$assets = KODETY_DIR . 'assets/manifest.json';
if (!is_file($assets)) {
    wp_die($admin_ui_translate('Os assets do Onun Kodety não foram compilados. Execute npm run wordpress:build.'), 'Onun Kodety', ['response' => 500]);
}

$manifest = json_decode((string) file_get_contents($assets), true);
$entry = $manifest['Wordpress/email-editor/main.tsx'] ?? null;
if (!$entry) {
    wp_die($admin_ui_translate('O construtor de email não foi encontrado no pacote instalado.'), 'Onun Kodety', ['response' => 500]);
}

$script = Kodety_Assets::entry_script($manifest, 'Wordpress/email-editor/main.tsx');
// Inclui o CSS dos chunks compartilhados (design system), que não aparece em
// `css` da entrada quando o build tem mais de um ponto de entrada.
$styles = Kodety_Assets::entry_styles($manifest, 'Wordpress/email-editor/main.tsx');
$template_id = absint($_GET['template'] ?? 0);
$admin_ui_i18n = $admin_ui_i18n_service
    ? $admin_ui_i18n_service->client_config('document')
    : null;

$config = [
    'templatesUrl' => rest_url('kodety/v1/email/templates'),
    'templateUrl' => rest_url('kodety/v1/email/templates/{id}'),
    'mediaUrl' => rest_url('wp/v2/media'),
    'campaignsUrl' => admin_url('admin.php?page=' . Kodety_Email_Marketing::PAGE_TEMPLATES),
    'nonce' => wp_create_nonce('wp_rest'),
    'templateId' => $template_id,
    'canManage' => current_user_can(Kodety_Email_Schema::CAP_MANAGE),
    'adminUiI18n' => $admin_ui_i18n,
];
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title><?php echo esc_html($admin_ui_translate('Construtor de email')); ?> — <?php echo esc_html(get_bloginfo('name')); ?></title>
    <?php foreach ($styles as $style): ?>
        <link rel="stylesheet" href="<?php echo esc_url(Kodety_Assets::asset_url($style)); ?>">
    <?php endforeach; ?>
    <?php // JSON_HEX_TAG impede que qualquer valor feche o <script> à força. ?>
    <script>window.kodetyEmailEditor = <?php echo wp_json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE); ?>;window.kodetyAdminI18n=window.kodetyEmailEditor.adminUiI18n;</script>
    <?php if ($admin_ui_i18n): ?><script src="<?php echo esc_url(add_query_arg('ver', (string) filemtime(KODETY_DIR . 'admin/i18n.js'), KODETY_URL . 'admin/i18n.js')); ?>"></script><?php endif; ?>
</head>
<body>
    <div id="kodety-email-root"></div>
    <script type="module" src="<?php echo esc_url(Kodety_Assets::asset_url($script)); ?>"></script>
</body>
</html>
