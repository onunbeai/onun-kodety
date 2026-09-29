<?php
/**
 * Tela de templates de email.
 *
 * É a ponte entre o wp-admin e o construtor: lista o que existe e abre o
 * editor, que roda numa rota e num bundle próprios.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Admin_Templates {
    public static function render(): void {
        if (!current_user_can(Kodety_Email_Schema::CAP_VIEW)) return;

        $search = sanitize_text_field((string) wp_unslash($_GET['template_search'] ?? ''));
        $page = max(1, absint($_GET['template_page'] ?? 1));
        $pagination = self::paginate_templates($search, $page, 25);
        $templates = $pagination['items'];
        $templates_total = self::templates_count();
        $can_manage = current_user_can(Kodety_Email_Schema::CAP_MANAGE);
        ?>
        <div class="wrap kodety-emails kodety-email-marketing">
            <?php Kodety_Email_Admin::header('Templates', 'O conteúdo dos seus emails, criado no construtor.', 'templates'); ?>
            <?php Kodety_Email_Admin::notices(); ?>

            <?php if ($can_manage): ?>
                <section class="kodety-builder-cta">
                    <div class="kodety-builder-cta__copy">
                        <p class="kodety-eyebrow">Construtor de email</p>
                        <h2>Monte o email em blocos</h2>
                        <p>
                            Layout em tabelas, CSS já inline e verificação de compatibilidade com Outlook,
                            Gmail e Apple Mail. É uma aplicação separada do editor de sites — nada aqui
                            afeta as páginas publicadas.
                        </p>
                        <div class="kodety-builder-cta__features" aria-label="Recursos do construtor">
                            <span>Prévia responsiva</span>
                            <span>HTML inline</span>
                            <span>Lint antes do envio</span>
                        </div>
                    </div>
                    <a class="button button-primary button-hero" href="<?php echo esc_url(Kodety_Email_Marketing::editor_url()); ?>">
                        Criar template
                    </a>
                </section>
            <?php endif; ?>

            <?php if ($templates_total === 0): ?>
                <section class="kodety-empty-state">
                    <span class="kodety-empty-state__icon" aria-hidden="true">✦</span>
                    <h2>Seu primeiro email começa aqui</h2>
                    <p>Crie um template no construtor e depois escolha-o ao preparar uma campanha.</p>
                    <?php if ($can_manage): ?>
                        <a class="button button-primary" href="<?php echo esc_url(Kodety_Email_Marketing::editor_url()); ?>">Criar primeiro template</a>
                    <?php endif; ?>
                </section>
            <?php else: ?>
                <section class="kodety-content-section">
                    <header class="kodety-section-heading">
                        <div>
                            <p class="kodety-eyebrow">Biblioteca</p>
                            <h2><?php echo Kodety_Admin_I18n::instance()->format_number($pagination['total']); ?> template(s)</h2>
                            <p>Edite o conteúdo sem alterar campanhas que já foram enviadas.</p>
                        </div>
                        <form class="kodety-table-toolbar" method="get" action="<?php echo esc_url(admin_url('admin.php')); ?>">
                            <input type="hidden" name="page" value="<?php echo esc_attr(Kodety_Email_Marketing::PAGE_TEMPLATES); ?>">
                            <label class="kodety-table-search">
                                <span class="screen-reader-text">Buscar template</span>
                                <input type="search" name="template_search" value="<?php echo esc_attr($search); ?>"
                                       placeholder="Buscar template…">
                            </label>
                            <button class="button">Buscar</button>
                            <?php if ($search !== ''): ?>
                                <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=' . Kodety_Email_Marketing::PAGE_TEMPLATES)); ?>">Limpar</a>
                            <?php endif; ?>
                        </form>
                    </header>

                    <?php if (!$templates): ?>
                        <div class="kodety-empty-state is-compact">
                            <h3>Nenhum template corresponde à busca</h3>
                            <p>Tente outro termo ou volte à biblioteca completa.</p>
                            <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=' . Kodety_Email_Marketing::PAGE_TEMPLATES)); ?>">Limpar busca</a>
                        </div>
                    <?php else: ?>
                    <div class="kodety-email-table">
                    <table>
                        <thead><tr><th>Template</th><th>Em uso</th><th>Atualizado</th><th class="kodety-col-actions">Ações</th></tr></thead>
                        <tbody>
                            <?php foreach ($templates as $template): ?>
                                <tr>
                                    <td>
                                        <span class="kodety-email-contact">
                                            <strong><?php echo esc_html($template['name']); ?></strong>
                                            <span>Template #<?php echo absint($template['id']); ?></span>
                                        </span>
                                    </td>
                                    <td>
                                        <?php if ((int) $template['usage_count'] > 0): ?>
                                            <span class="kodety-email-pill"><?php echo Kodety_Admin_I18n::instance()->format_number((int) $template['usage_count']); ?> campanha(s)</span>
                                        <?php else: ?>
                                            <span class="kodety-table-date">Livre</span>
                                        <?php endif; ?>
                                    </td>
                                    <td><?php echo esc_html(Kodety_Admin_I18n::instance()->format_mysql_gmt((string) $template['updated_at'])); ?></td>
                                    <td class="kodety-col-actions">
                                        <?php if ($can_manage): ?>
                                            <a class="button" href="<?php echo esc_url(Kodety_Email_Marketing::editor_url((int) $template['id'])); ?>">Editar</a>
                                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                                                <input type="hidden" name="action" value="kodety_email_duplicate_template">
                                                <input type="hidden" name="template_id" value="<?php echo absint($template['id']); ?>">
                                                <?php wp_nonce_field('kodety_email_duplicate_template'); ?>
                                                <button class="button">Duplicar</button>
                                            </form>
                                            <?php if ((int) $template['usage_count'] === 0): ?>
                                                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"
                                                      onsubmit="return confirm('Apagar este template definitivamente?');">
                                                    <input type="hidden" name="action" value="kodety_email_delete_template">
                                                    <input type="hidden" name="template_id" value="<?php echo absint($template['id']); ?>">
                                                    <?php wp_nonce_field('kodety_email_delete_template'); ?>
                                                    <button class="button kodety-button-danger">Apagar</button>
                                                </form>
                                            <?php else: ?>
                                                <button class="button" disabled title="Reatribua as campanhas antes de apagar">Em uso</button>
                                            <?php endif; ?>
                                        <?php endif; ?>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                    </div>
                    <?php self::render_pagination($pagination, $search); ?>
                    <?php endif; ?>
                </section>
            <?php endif; ?>
        </div>
        <?php
    }

    /** @return array{items:array,total:int,page:int,pages:int,per_page:int} */
    private static function paginate_templates(string $search, int $page, int $per_page): array {
        global $wpdb;

        $table = Kodety_Email_Schema::table('templates');
        $per_page = max(10, min(100, $per_page));
        $where = "kind = 'campaign'";
        $params = [];
        if ($search !== '') {
            $where .= ' AND (name LIKE %s OR CAST(id AS CHAR) = %s)';
            $params[] = '%' . $wpdb->esc_like($search) . '%';
            $params[] = ltrim($search, '#');
        }

        $count_sql = "SELECT COUNT(*) FROM {$table} WHERE {$where}";
        if ($params) $count_sql = $wpdb->prepare($count_sql, ...$params);
        $total = (int) $wpdb->get_var($count_sql);
        $pages = max(1, (int) ceil($total / $per_page));
        $page = min(max(1, $page), $pages);
        $offset = ($page - 1) * $per_page;

        $campaigns = Kodety_Email_Schema::table('campaigns');
        $qualified_where = str_replace(
            ['kind =', 'name LIKE', 'CAST(id AS CHAR)'],
            ['t.kind =', 't.name LIKE', 'CAST(t.id AS CHAR)'],
            $where
        );
        $items_sql = "SELECT t.id, t.name, t.kind, t.thumbnail_id, t.updated_at,
                             COUNT(c.id) usage_count
                      FROM {$table} t
                      LEFT JOIN {$campaigns} c ON c.template_id = t.id
                      WHERE {$qualified_where}
                      GROUP BY t.id, t.name, t.kind, t.thumbnail_id, t.updated_at
                      ORDER BY t.updated_at DESC, t.id DESC
                      LIMIT %d OFFSET %d";
        $items = $wpdb->get_results($wpdb->prepare(
            $items_sql,
            ...array_merge($params, [$per_page, $offset])
        ), ARRAY_A);

        return [
            'items' => is_array($items) ? $items : [],
            'total' => $total,
            'page' => $page,
            'pages' => $pages,
            'per_page' => $per_page,
        ];
    }

    private static function templates_count(): int {
        global $wpdb;
        return (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM " . Kodety_Email_Schema::table('templates') . " WHERE kind = 'campaign'"
        );
    }

    /** @param array{page:int,pages:int} $pagination */
    private static function render_pagination(array $pagination, string $search): void {
        if ((int) $pagination['pages'] <= 1) return;

        $placeholder = 999999999;
        $args = [
            'page' => Kodety_Email_Marketing::PAGE_TEMPLATES,
            'template_page' => $placeholder,
        ];
        if ($search !== '') $args['template_search'] = $search;
        $base = str_replace(
            (string) $placeholder,
            '%#%',
            add_query_arg($args, admin_url('admin.php'))
        );
        $links = paginate_links([
            'base' => $base,
            'format' => '',
            'current' => (int) $pagination['page'],
            'total' => (int) $pagination['pages'],
            'mid_size' => 2,
            'end_size' => 1,
            'prev_text' => '<span data-kodety-icon="chevron-left" data-kodety-icon-size="14" aria-hidden="true"></span>' . '<span>' . esc_html(Kodety_Admin_I18n::instance()->translate('Anterior')) . '</span>',
            'next_text' => '<span>' . esc_html(Kodety_Admin_I18n::instance()->translate('Próxima')) . '</span>' . '<span data-kodety-icon="chevron-right" data-kodety-icon-size="14" aria-hidden="true"></span>',
            'type' => 'array',
        ]);
        if (!is_array($links)) return;
        ?>
        <nav class="kodety-pagination" aria-label="Paginação dos templates">
            <?php echo wp_kses_post(implode(' ', $links)); ?>
        </nav>
        <?php
    }
}
