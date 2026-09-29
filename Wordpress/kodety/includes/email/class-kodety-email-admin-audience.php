<?php
/**
 * Telas de contatos e listas.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Admin_Audience {
    public static function render_contacts(): void {
        if (!current_user_can(Kodety_Email_Schema::CAP_VIEW)) return;

        $counts = Kodety_Email_Contacts::status_counts();
        $lists = Kodety_Email_Contacts::lists();
        $can_manage = current_user_can(Kodety_Email_Schema::CAP_MANAGE);

        $args = [
            'search' => isset($_GET['s']) ? sanitize_text_field((string) wp_unslash($_GET['s'])) : '',
            'status' => isset($_GET['status']) ? sanitize_key((string) wp_unslash($_GET['status'])) : '',
            'list_id' => absint($_GET['list'] ?? 0),
            'page' => max(1, absint($_GET['paged'] ?? 1)),
            'per_page' => 30,
        ];
        $result = Kodety_Email_Contacts::paginate($args);
        $total_pages = (int) ceil($result['total'] / $args['per_page']);
        $memberships = Kodety_Email_Contacts::lists_for_contacts(
            array_map(static fn(array $item): int => (int) $item['id'], $result['items'])
        );
        $has_filters = $args['search'] !== '' || $args['status'] !== '' || $args['list_id'] > 0;
        ?>
        <div class="wrap kodety-emails kodety-email-marketing">
            <?php Kodety_Email_Admin::header('Contatos', 'A base de quem recebe suas campanhas.', 'contacts'); ?>
            <?php Kodety_Email_Admin::notices(); ?>

            <section class="kodety-email-stats is-five" aria-label="Resumo dos contatos por status">
                <?php
                $cards = [
                    ['', 'Total', array_sum($counts), 'todos os status'],
                    ['subscribed', 'Inscritos', $counts['subscribed'], 'aptos para campanhas'],
                    ['unsubscribed', 'Descadastrados', $counts['unsubscribed'], 'saída voluntária'],
                    ['bounced', 'Bounces', $counts['bounced'], 'suprimidos por retorno'],
                    ['complained', 'Reclamações', $counts['complained'], 'suprimidos por denúncia'],
                ];
                foreach ($cards as [$status, $label, $value, $detail]):
                    $url = add_query_arg(array_filter([
                        'page' => Kodety_Email_Marketing::PAGE_CONTACTS,
                        'status' => $status,
                    ]), admin_url('admin.php'));
                    ?>
                    <a href="<?php echo esc_url($url); ?>"
                       class="<?php echo $args['status'] === $status ? 'is-current' : ''; ?>"
                       <?php echo $args['status'] === $status ? 'aria-current="true"' : ''; ?>>
                        <span><?php echo esc_html($label); ?></span>
                        <strong><?php echo Kodety_Admin_I18n::instance()->format_number((int) $value); ?></strong>
                        <small><?php echo esc_html($detail); ?></small>
                    </a>
                <?php endforeach; ?>
            </section>

            <?php if ($can_manage): ?>
                <div class="kodety-audience-actions">
                    <form class="kodety-audience-form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                        <input type="hidden" name="action" value="kodety_email_add_contact">
                        <?php wp_nonce_field('kodety_email_add_contact'); ?>
                        <p class="kodety-eyebrow">Individual</p>
                        <strong>Adicionar contato</strong>
                        <p>Cadastre uma pessoa e associe-a a uma lista em uma única etapa.</p>
                        <div class="kodety-audience-form__row">
                            <input type="email" name="email" required aria-label="Email do contato" placeholder="email@exemplo.com">
                            <input type="text" name="name" aria-label="Nome do contato" placeholder="Nome (opcional)">
                            <select name="list_id" aria-label="Lista do contato">
                                <option value="0">Sem lista</option>
                            <?php foreach ($lists as $list): ?>
                                <option value="<?php echo absint($list['id']); ?>"><?php echo esc_html($list['name']); ?></option>
                            <?php endforeach; ?>
                            </select>
                        </div>
                        <label class="kodety-consent-confirmation">
                            <input type="checkbox" name="consent_confirmed" value="1" aria-describedby="kodety-manual-consent-help">
                            <span>
                                <strong>Confirmo a base legal para comunicações de marketing.</strong>
                                <small id="kodety-manual-consent-help">Pela LGPD, registre apenas contatos com consentimento ou outra base legal documentada. Sem confirmação, o contato fica pendente e não recebe campanhas.</small>
                            </span>
                        </label>
                        <button class="button button-primary kodety-audience-form__submit">Adicionar contato</button>
                    </form>

                    <form class="kodety-audience-form" method="post" enctype="multipart/form-data"
                          action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                        <input type="hidden" name="action" value="kodety_email_import_csv">
                        <?php wp_nonce_field('kodety_email_import_csv'); ?>
                        <p class="kodety-eyebrow">Em lote</p>
                        <strong>Importar CSV</strong>
                        <p>Traga uma base existente sem perder atributos personalizados.</p>
                        <div class="kodety-audience-form__row">
                            <input type="file" name="csv" accept=".csv,text/csv" required aria-label="Arquivo CSV">
                            <select name="list_id" aria-label="Lista de destino da importação">
                                <option value="0">Sem lista</option>
                            <?php foreach ($lists as $list): ?>
                                <option value="<?php echo absint($list['id']); ?>"><?php echo esc_html($list['name']); ?></option>
                            <?php endforeach; ?>
                            </select>
                        </div>
                        <label class="kodety-consent-confirmation">
                            <input type="checkbox" name="consent_confirmed" value="1" aria-describedby="kodety-import-consent-help">
                            <span>
                                <strong>Confirmo a base legal dos contatos deste arquivo.</strong>
                                <small id="kodety-import-consent-help">Pela LGPD, importe somente contatos com consentimento ou outra base legal documentada. Sem confirmação, os novos contatos ficam pendentes e não recebem campanhas.</small>
                            </span>
                        </label>
                        <button class="button kodety-audience-form__submit">Importar contatos</button>
                        <small>Precisa de uma coluna <code>email</code>. Colunas extras viram atributos usáveis em merge tag.</small>
                    </form>
                </div>
            <?php endif; ?>

            <section class="kodety-content-section">
                <header class="kodety-section-heading">
                    <div>
                        <p class="kodety-eyebrow">Base de contatos</p>
                        <h2><?php echo Kodety_Admin_I18n::instance()->format_number((int) $result['total']); ?> resultado(s)</h2>
                        <p>Use filtros e ações em massa para organizar a audiência com segurança.</p>
                    </div>
                </header>

                <form class="kodety-email-filters" method="get">
                    <input type="hidden" name="page" value="<?php echo esc_attr(Kodety_Email_Marketing::PAGE_CONTACTS); ?>">
                    <label class="is-search">
                        <span class="screen-reader-text">Buscar por email ou nome</span>
                        <input type="search" name="s" value="<?php echo esc_attr($args['search']); ?>" placeholder="Buscar por email ou nome">
                    </label>
                    <label>
                        <span class="screen-reader-text">Filtrar por status</span>
                        <select name="status">
                            <option value="">Todos os status</option>
                            <?php foreach ([
                                'subscribed' => 'Inscritos',
                                'unsubscribed' => 'Descadastrados',
                                'bounced' => 'Bounces',
                                'complained' => 'Reclamações',
                                'pending' => 'Pendentes',
                            ] as $key => $label): ?>
                                <option value="<?php echo esc_attr($key); ?>" <?php selected($args['status'], $key); ?>><?php echo esc_html($label); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                    <label>
                        <span class="screen-reader-text">Filtrar por lista</span>
                        <select name="list">
                            <option value="0">Todas as listas</option>
                            <?php foreach ($lists as $list): ?>
                                <option value="<?php echo absint($list['id']); ?>" <?php selected($args['list_id'], (int) $list['id']); ?>><?php echo esc_html($list['name']); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                    <button class="button button-primary">Filtrar</button>
                    <?php if ($has_filters): ?>
                        <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=' . Kodety_Email_Marketing::PAGE_CONTACTS)); ?>">Limpar filtros</a>
                    <?php endif; ?>
                </form>

            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" data-kodety-bulk>
                <input type="hidden" name="action" value="kodety_email_bulk_contacts">
                <?php wp_nonce_field('kodety_email_bulk_contacts'); ?>
                <?php // Repassa o filtro atual para a opção "todos que correspondem". ?>
                <input type="hidden" name="filter_s" value="<?php echo esc_attr($args['search']); ?>">
                <input type="hidden" name="filter_status" value="<?php echo esc_attr($args['status']); ?>">
                <input type="hidden" name="filter_list" value="<?php echo absint($args['list_id']); ?>">

                <?php if ($can_manage): ?>
                    <div class="kodety-email-bulk kodety-bulk-bar">
                        <select name="bulk_action" data-kodety-bulk-action aria-label="Ação em massa">
                            <option value="">Ação em massa…</option>
                            <option value="add_to_list">Adicionar à lista</option>
                            <option value="remove_from_list">Remover da lista</option>
                            <option value="subscribe">Marcar como inscrito</option>
                            <option value="unsubscribe">Marcar como descadastrado</option>
                            <option value="delete">Apagar contatos</option>
                        </select>
                        <select name="list_id" data-kodety-bulk-list aria-label="Lista da ação em massa">
                            <option value="">Escolha a lista…</option>
                            <?php foreach ($lists as $list): ?>
                                <option value="<?php echo absint($list['id']); ?>"><?php echo esc_html($list['name']); ?></option>
                            <?php endforeach; ?>
                        </select>
                        <button class="button" data-kodety-bulk-apply>Aplicar</button>
                        <span data-kodety-bulk-count><?php echo Kodety_Admin_I18n::instance()->format_number($result['total']); ?> contatos</span>
                    </div>

                    <label class="kodety-bulk-all" data-kodety-bulk-all-row hidden>
                        <input type="checkbox" name="select_all_matching" value="1">
                        Selecionar todos os <?php echo Kodety_Admin_I18n::instance()->format_number($result['total']); ?> contatos que correspondem ao filtro
                    </label>
                <?php endif; ?>

                <div class="kodety-email-table">
                    <table>
                        <thead>
                            <tr>
                                <?php if ($can_manage): ?>
                                    <th class="kodety-col-check"><input type="checkbox" data-kodety-check-all aria-label="Selecionar todos desta página"></th>
                                <?php endif; ?>
                                <th>Contato</th><th>Status</th><th>Listas</th><th>Origem do contato</th><th>Adicionado</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php if (!$result['items']): ?>
                                <tr>
                                    <td colspan="<?php echo $can_manage ? 6 : 5; ?>" class="kodety-email-empty">
                                        <strong>Nenhum contato encontrado</strong>
                                        <span>Ajuste os filtros ou adicione um novo contato à base.</span>
                                    </td>
                                </tr>
                            <?php endif; ?>
                            <?php foreach ($result['items'] as $contact): ?>
                                <tr>
                                    <?php if ($can_manage): ?>
                                        <td class="kodety-col-check">
                                            <input type="checkbox" name="contact_ids[]" value="<?php echo absint($contact['id']); ?>"
                                                   aria-label="<?php echo esc_attr('Selecionar ' . $contact['email']); ?>">
                                        </td>
                                    <?php endif; ?>
                                    <td>
                                        <span class="kodety-email-contact">
                                            <strong><?php echo esc_html($contact['name'] !== '' ? $contact['name'] : '—'); ?></strong>
                                            <span><?php echo esc_html($contact['email']); ?></span>
                                        </span>
                                    </td>
                                    <td><span class="kodety-contact-status is-<?php echo esc_attr($contact['status']); ?>"><?php echo esc_html(self::status_label((string) $contact['status'])); ?></span></td>
                                    <td>
                                        <?php $contact_lists = $memberships[(int) $contact['id']] ?? []; ?>
                                        <?php if (!$contact_lists): ?>
                                            <span class="kodety-muted">—</span>
                                        <?php endif; ?>
                                        <?php foreach ($contact_lists as $name): ?>
                                            <span class="kodety-email-pill"><?php echo esc_html($name); ?></span>
                                        <?php endforeach; ?>
                                    </td>
                                    <td><span class="kodety-email-pill"><?php echo esc_html($contact['consent_source'] !== '' ? $contact['consent_source'] : 'manual'); ?></span></td>
                                    <td><?php echo esc_html(Kodety_Admin_I18n::instance()->format_mysql_gmt((string) $contact['created_at'], 'short_date')); ?></td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            </form>

            <?php if ($total_pages > 1): ?>
                <div class="kodety-pagination">
                    <?php echo wp_kses_post((string) paginate_links([
                        'base' => add_query_arg('paged', '%#%'),
                        'format' => '',
                        'current' => $args['page'],
                        'total' => $total_pages,
                        'prev_text' => '<span data-kodety-icon="chevron-left" data-kodety-icon-size="14" aria-hidden="true"></span>' . '<span class="screen-reader-text">' . esc_html(Kodety_Admin_I18n::instance()->translate('Anterior')) . '</span>',
                        'next_text' => '<span class="screen-reader-text">' . esc_html(Kodety_Admin_I18n::instance()->translate('Próxima')) . '</span>' . '<span data-kodety-icon="chevron-right" data-kodety-icon-size="14" aria-hidden="true"></span>',
                    ])); ?>
                </div>
            <?php endif; ?>
            </section>
        </div>
        <?php
    }

    public static function render_lists(): void {
        if (!current_user_can(Kodety_Email_Schema::CAP_VIEW)) return;

        $lists = Kodety_Email_Contacts::lists(true);
        $can_manage = current_user_can(Kodety_Email_Schema::CAP_MANAGE);
        $subscriber_total = array_sum(array_map(static fn(array $list): int => (int) $list['subscriber_count'], $lists));
        $source_total = count(array_unique(array_map(static fn(array $list): string => (string) $list['source'], $lists)));
        ?>
        <div class="wrap kodety-emails kodety-email-marketing">
            <?php Kodety_Email_Admin::header('Listas', 'Agrupe contatos para escolher quem recebe cada campanha.', 'lists'); ?>
            <?php Kodety_Email_Admin::notices(); ?>

            <section class="kodety-overview-grid is-compact" aria-label="Resumo das listas">
                <?php foreach ([
                    ['Listas', count($lists), 'grupos disponíveis'],
                    ['Inscrições', $subscriber_total, 'soma dos membros ativos'],
                    ['Origens', $source_total, 'fontes conectadas'],
                ] as [$label, $value, $detail]): ?>
                    <article class="kodety-overview-card">
                        <span><?php echo esc_html($label); ?></span>
                        <strong><?php echo Kodety_Admin_I18n::instance()->format_number((int) $value); ?></strong>
                        <small><?php echo esc_html($detail); ?></small>
                    </article>
                <?php endforeach; ?>
            </section>

            <?php if ($can_manage): ?>
                <div class="kodety-audience-actions">
                    <form class="kodety-audience-form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                        <input type="hidden" name="action" value="kodety_email_create_list">
                        <?php wp_nonce_field('kodety_email_create_list'); ?>
                        <p class="kodety-eyebrow">Segmentação</p>
                        <strong>Nova lista</strong>
                        <p>Crie um grupo reutilizável para campanhas atuais e futuras.</p>
                        <div class="kodety-audience-form__row">
                            <input type="text" name="name" required aria-label="Nome da lista" placeholder="Newsletter semanal">
                            <input type="text" name="description" aria-label="Descrição da lista" placeholder="Descrição (opcional)">
                            <button class="button button-primary">Criar lista</button>
                        </div>
                    </form>

                    <form class="kodety-audience-form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                        <input type="hidden" name="action" value="kodety_email_sync_source">
                        <?php wp_nonce_field('kodety_email_sync_source'); ?>
                        <p class="kodety-eyebrow">Sincronização</p>
                        <strong>Importar de dentro do Onun Kodety</strong>
                        <p>Conecte dados já coletados pelo site à base de email.</p>
                        <div class="kodety-audience-form__row">
                            <select name="source" aria-label="Origem dos contatos" <?php disabled(!$lists); ?>>
                                <option value="forms">Envios de formulários do site</option>
                                <option value="members">Membros da área de membros</option>
                            </select>
                            <select name="list_id" required aria-label="Lista de destino" <?php disabled(!$lists); ?>>
                                <option value="">Escolha a lista de destino</option>
                                <?php foreach ($lists as $list): ?>
                                    <option value="<?php echo absint($list['id']); ?>"><?php echo esc_html($list['name']); ?></option>
                                <?php endforeach; ?>
                            </select>
                            <button class="button" <?php disabled(!$lists); ?>>Sincronizar</button>
                        </div>
                        <small>Traz os contatos que já existem no site para a lista escolhida, registrando a origem do consentimento.</small>
                    </form>
                </div>
            <?php endif; ?>

            <?php if (!$lists): ?>
                <section class="kodety-empty-state">
                    <span class="kodety-empty-state__icon" aria-hidden="true">◎</span>
                    <h2>Crie sua primeira lista</h2>
                    <p>Listas transformam uma base única em públicos claros para cada campanha.</p>
                </section>
            <?php else: ?>
                <section class="kodety-content-section" data-kodety-filter-scope>
                    <header class="kodety-section-heading">
                        <div>
                            <p class="kodety-eyebrow">Públicos</p>
                            <h2>Listas disponíveis</h2>
                            <p>Abra uma lista para revisar seus contatos ativos.</p>
                        </div>
                        <label class="kodety-table-search">
                            <span class="screen-reader-text">Buscar lista</span>
                            <input type="search" placeholder="Buscar lista…" data-kodety-table-search>
                        </label>
                    </header>
                    <div class="kodety-list-grid">
                    <?php foreach ($lists as $list): ?>
                        <article class="kodety-list-card" data-kodety-filter-row
                                 data-kodety-search="<?php echo esc_attr((string) $list['name'] . ' ' . (string) $list['description'] . ' ' . (string) $list['source']); ?>">
                            <header>
                                <strong><?php echo esc_html($list['name']); ?></strong>
                                <span class="kodety-email-pill"><?php echo esc_html($list['source']); ?></span>
                            </header>
                            <p class="kodety-list-card__count">
                                <b><?php echo Kodety_Admin_I18n::instance()->format_number((int) $list['subscriber_count']); ?></b>
                                <span>inscritos ativos</span>
                            </p>
                            <?php if ((string) $list['description'] !== ''): ?>
                                <p class="kodety-list-card__description"><?php echo esc_html($list['description']); ?></p>
                            <?php endif; ?>
                            <?php $reference_count = (int) ($list['campaign_reference_count'] ?? 0); ?>
                            <?php if ($reference_count > 0): ?>
                                <p class="kodety-list-card__description">
                                    Em uso por <?php echo Kodety_Admin_I18n::instance()->format_number($reference_count); ?> campanha(s) editável(is) ou agendada(s).
                                    Troque a audiência da campanha antes de apagar esta lista.
                                </p>
                            <?php endif; ?>
                            <footer>
                                <a class="button" href="<?php echo esc_url(add_query_arg([
                                    'page' => Kodety_Email_Marketing::PAGE_CONTACTS,
                                    'list' => (int) $list['id'],
                                ], admin_url('admin.php'))); ?>">Ver contatos</a>
                                <?php if ($can_manage): ?>
                                    <?php if ($reference_count > 0): ?>
                                        <button class="button" type="button" disabled
                                                title="Remova esta lista da audiência das campanhas antes de apagá-la.">
                                            Em uso
                                        </button>
                                    <?php else: ?>
                                        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"
                                              onsubmit="return confirm('Apagar a lista? Os contatos permanecem na base.');">
                                            <input type="hidden" name="action" value="kodety_email_delete_list">
                                            <input type="hidden" name="list_id" value="<?php echo absint($list['id']); ?>">
                                            <?php wp_nonce_field('kodety_email_delete_list'); ?>
                                            <button class="button kodety-button-danger">Apagar</button>
                                        </form>
                                    <?php endif; ?>
                                <?php endif; ?>
                            </footer>
                        </article>
                    <?php endforeach; ?>
                    </div>
                    <p class="kodety-table-no-results" data-kodety-table-empty hidden>Nenhuma lista corresponde à busca.</p>
                </section>
            <?php endif; ?>
        </div>
        <?php
    }

    private static function status_label(string $status): string {
        return match ($status) {
            'subscribed' => 'inscrito',
            'unsubscribed' => 'descadastrado',
            'bounced' => 'suprimido',
            'complained' => 'reclamação',
            default => 'pendente',
        };
    }
}
