<?php
defined('ABSPATH') || exit;
$base = get_current_screen()?->base ?? '';
$layout = $base === 'dashboard' ? 'dashboard' : (in_array($base, ['edit', 'edit-comments', 'users', 'plugins', 'edit-tags', 'link-manager', 'sites'], true) ? 'list' : (in_array($base, ['themes', 'theme-install', 'plugin-install', 'upload', 'kodety_page_kodety-templates', 'kodety_page_kodety-media'], true) ? 'cards' : 'settings'));
?>
<div id="kodety-navigation-loading" class="kodety-ui-loading" data-layout="<?php echo esc_attr($layout); ?>" aria-hidden="true">
    <div class="kodety-ui-loading__canvas">
        <div class="kodety-ui-loading__heading"><div><i></i><b></b><span></span></div><em></em></div>
        <div class="kodety-ui-loading__metrics">
            <?php for ($item = 0; $item < 4; $item++): ?><div><i></i><b></b><span></span></div><?php endfor; ?>
        </div>
        <div class="kodety-ui-loading__toolbar"><i></i><span></span><em></em></div>
        <div class="kodety-ui-loading__panel">
            <div class="kodety-ui-loading__panel-heading"><i></i><span></span></div>
            <?php for ($item = 0; $item < 6; $item++): ?>
                <div class="kodety-ui-loading__row"><i></i><div><b></b><span></span></div><em></em><strong></strong></div>
            <?php endfor; ?>
        </div>
    </div>
</div>
<span id="kodety-navigation-status" class="screen-reader-text" role="status" aria-live="polite"></span>
