<?php
defined('ABSPATH') || exit;

// An inert first frame, built from this request's permitted WP menu. The shell
// replaces it in one synchronous pass; no cached account data or extra requests.
global $menu, $submenu, $parent_file;
echo '<script>try{if(matchMedia("(min-width:783px)").matches&&localStorage.getItem("kodety.sidebar.collapsed")==="true")document.body.classList.add("kodety-ui-sidebar-collapsed")}catch(e){}</script>';
$english = str_starts_with(strtolower($admin_data['uiLocale']), 'en');
$ui = static fn(string $pt, string $en): string => $english ? $en : $pt;
$sprite = KODETY_URL . 'admin/components/shell-icons.svg?ver=' . filemtime(KODETY_DIR . 'admin/components/shell-icons.svg');
$icon = static function (string $name) use ($sprite): string {
    if ($name === 'kodety') return '<span class="kodety-ui-icon kodety-ui-nav-link__icon"><svg viewBox="0 0 114 122" fill="currentColor"><path d="M51.1932 122L0 61L113.183 94.8289V122H51.1932Z M51.1932 0L0 61L113.183 27.1711V0H51.1932Z"/></svg></span>';
    return '<span class="kodety-ui-icon kodety-ui-nav-link__icon"><svg aria-hidden="true"><use href="' . esc_url($sprite . '#' . $name) . '"/></svg></span>';
};
$url = static fn(string $slug): string => preg_match('~^(?:https?:)?//~', $slug) ? $slug : admin_url(str_contains($slug, '.php') ? $slug : 'admin.php?page=' . $slug);
$label = static fn(string $value): string => trim(html_entity_decode(wp_strip_all_tags((string) preg_replace('~<span\b[^>]*>.*?</span>~s', '', $value)), ENT_QUOTES, 'UTF-8'));
$names = [
    'index.php'=>'Dashboard', 'edit.php?post_type=page'=>$ui('Páginas','Pages'), 'edit-comments.php'=>$ui('Comentários','Comments'),
    'themes.php'=>$ui('Aparência','Appearance'), 'users.php'=>$ui('Usuários','Users'), 'tools.php'=>$ui('Ferramentas','Tools'),
    'options-general.php'=>$ui('Ajustes','Settings'), 'kodety-editor'=>'Builder', 'kodety-cms'=>'CMS', 'kodety-analytics'=>$ui('Análises','Analytics'),
    'kodety-media'=>$ui('Mídias','Media'), 'kodety-emails'=>$ui('E-mails','Emails'), 'kodety-email-campaigns'=>'Marketing',
    'kodety-members'=>$ui('Membros','Members'), 'kodety-templates'=>$ui('Modelos','Templates'),
];
$icons = ['index.php'=>'dashboard','edit.php'=>'files','edit.php?post_type=page'=>'files','edit-comments.php'=>'comments','themes.php'=>'appearance','plugins.php'=>'plugins','users.php'=>'users','tools.php'=>'tools','options-general.php'=>'settings','kodety-editor'=>'editor','kodety-cms'=>'database','kodety-analytics'=>'analytics','kodety-media'=>'image','kodety-emails'=>'mail','kodety-email-campaigns'=>'marketing','kodety-members'=>'users','kodety-updates'=>'refresh','kodety-license'=>'lock','kodety-project-settings'=>'settings'];
$native = $hub = [];
$project = false;
foreach ($menu ?? [] as $item) {
    if (empty($item[0]) || !current_user_can($item[1]) || str_starts_with($item[2], 'separator')) continue;
    $slug = $item[2];
    if ($slug === 'kodety') { $project = true; continue; }
    if ($slug === 'kodety-manual') continue;
    $entry = ['slug'=>$slug, 'label'=>$names[$slug] ?? $label($item[0]), 'icon'=>$icons[$slug] ?? 'folder'];
    if (str_starts_with($slug, 'kodety-')) $hub[$slug] = $entry;
    else $native[$slug] = $entry;
}
if ($project) {
    foreach ($submenu['kodety'] ?? [] as $item) {
        if ($item[2] === 'kodety' || !current_user_can($item[1])) continue;
        $hub[$item[2]] = ['slug'=>$item[2], 'label'=>$names[$item[2]] ?? $label($item[0]), 'icon'=>$icons[$item[2]] ?? 'files'];
    }
    foreach ([['import','project',$ui('Importar','Import'),'upload'],['extensions','extensions',$ui('Extensões','Extensions'),'plugins'],['optimizations','optimizations',$ui('Otimizações','Optimizations'),'sparkles'],['security','security',$ui('Segurança','Security'),'shield'],['settings','settings',$ui('Configurações','Settings'),'settings']] as [$permission,$area,$title,$symbol]) {
        if (empty($admin_data['projectAreas'][$permission])) continue;
        $hub['area-'.$area] = ['slug'=>'admin.php?page=kodety#kodety-'.$area,'label'=>$title,'icon'=>$symbol,'area'=>$area];
    }
}
$order = array_flip(['area-project','kodety-editor','kodety-cms','kodety-analytics','kodety-media','kodety-emails','kodety-email-campaigns','kodety-members','kodety-templates','area-extensions','area-optimizations','area-security','area-settings','kodety-updates','kodety-license']);
uksort($hub, static fn($a,$b) => ($order[$a] ?? 99) <=> ($order[$b] ?? 99));
$render = static function (array $entry, bool $child = false) use ($icon,$url,$label,$submenu,$parent_file): void {
    $slug = $entry['slug'];
    $current = empty($entry['area']) && ($slug === ($GLOBALS['plugin_page'] ?? '') || $slug === ($GLOBALS['self'] ?? '') || $slug === ($parent_file ?? ''));
    $children = array_filter($submenu[$slug] ?? [], static fn($row) => $row[2] !== $slug && current_user_can($row[1]));
    echo '<li class="kodety-ui-nav-item'.($current?' is-current':'').($current && !$child && $children?' is-open':'').'"'.(!empty($entry['area'])?' data-first-area="'.esc_attr($entry['area']).'"':'').'><div class="kodety-ui-nav-item__head"><a class="kodety-ui-nav-link" href="'.esc_url($url($slug)).'">'.$icon($entry['icon']).'<span class="kodety-ui-nav-link__label">'.esc_html($entry['label']).'</span></a>';
    if ($children) echo '<span class="kodety-ui-nav-toggle">'.$icon('chevron-down').'</span>';
    echo '</div>';
    if ($current && !$child && $children) {
        echo '<ul class="kodety-ui-submenu">';
        foreach ($children as $row) echo '<li><a href="'.esc_url($url($row[2])).'">'.esc_html($label($row[0])).'</a></li>';
        echo '</ul>';
    }
    echo '</li>';
};
$user = wp_get_current_user();
?>
<aside id="kodety-sidebar-first-frame" class="kodety-ui-sidebar kodety-ui-first-frame" inert aria-hidden="true">
    <div class="kodety-ui-sidebar-header">
        <div class="kodety-ui-brand"><img class="kodety-ui-brand__full" src="<?php echo esc_url($admin_data['kodetyLogoUrl']); ?>" width="116" height="24" alt=""><span class="kodety-ui-brand__mark"><?php echo $icon('kodety'); ?></span></div>
        <span class="kodety-ui-search-toggle"><?php echo $icon('search'); ?></span>
        <div class="kodety-ui-command"><span class="kodety-ui-command__icon"><?php echo $icon('search'); ?></span><input type="search" placeholder="<?php echo esc_attr($ui('Buscar no painel','Search dashboard')); ?>" tabindex="-1"><kbd>⌘ K</kbd></div>
    </div>
    <div class="kodety-ui-navigation">
        <section class="kodety-ui-nav-section"><ul class="kodety-ui-nav-list">
        <?php if (isset($native['index.php'])) { $render($native['index.php']); unset($native['index.php']); } ?>
        <?php if ($hub): ?><li class="kodety-ui-nav-item is-open"><div class="kodety-ui-nav-item__head"><div class="kodety-ui-nav-link kodety-ui-nav-group kodety-ui-nav-group--fixed"><?php echo $icon('kodety'); ?><span class="kodety-ui-nav-link__label">Onun Kodety</span></div></div><ul class="kodety-ui-submenu"><?php foreach ($hub as $entry) $render($entry, true); ?></ul></li><?php endif; ?>
        </ul></section>
        <section class="kodety-ui-nav-section"><h2>WordPress</h2><ul class="kodety-ui-nav-list"><?php foreach ($native as $entry) $render($entry); ?></ul></section>
    </div>
    <footer class="kodety-ui-sidebar-footer">
        <nav class="kodety-ui-footer-shortcuts"><a><?php echo $icon('help'); ?><span><?php echo esc_html($ui('Central de ajuda','Help center')); ?></span></a></nav>
        <div class="kodety-ui-profile-row kodety-ui-profile-row--with-logout"><div class="kodety-ui-profile"><span class="kodety-ui-profile__avatar"><?php echo esc_html(mb_strtoupper(mb_substr($user->display_name,0,1))) . get_avatar($user->ID, 26, '', '', ['extra_attr' => 'aria-hidden="true"']); ?></span><span class="kodety-ui-profile__copy"><strong><?php echo esc_html($user->display_name); ?></strong><span><?php echo esc_html($ui('Conta WordPress','WordPress account')); ?></span></span><?php echo $icon('chevron-right'); ?></div><span class="kodety-ui-collapse kodety-ui-logout"><?php echo $icon('logout'); ?></span><span class="kodety-ui-collapse"><?php echo $icon('panel-close'); ?></span></div>
    </footer>
</aside>
<div class="kodety-ui-topbar kodety-ui-first-frame" inert aria-hidden="true">
    <div class="kodety-ui-topbar__identity"><div class="kodety-ui-area-switcher">
        <span class="kodety-ui-area-switcher__button"><?php echo $icon('blocks').esc_html($ui('Operacional','Operational')).str_replace('kodety-ui-nav-link__icon','kodety-ui-area-switcher__chevron',$icon('chevron-down')); ?></span>
        <nav class="kodety-ui-workspaces"><?php foreach ([['blocks',$ui('Operacional','Operational')],['database','CMS'],['files',$ui('Páginas','Pages')],['editor','Builder']] as $index => [$symbol,$title]): ?><span class="kodety-ui-workspace-tab<?php echo $index === 0 ? ' is-current' : ''; ?>"><?php echo $icon($symbol).esc_html($title); ?></span><?php endforeach; ?></nav>
    </div></div>
    <div class="kodety-ui-topbar__tools"><span class="kodety-ui-create__button"><?php echo $icon('plus').esc_html($ui('Criar','Create')); ?></span><div class="kodety-ui-topbar__icon-actions"><span class="kodety-ui-circle-action"><?php echo $icon('bell'); ?></span><span class="kodety-ui-circle-action"><?php echo $icon('website'); ?></span></div></div>
</div>
