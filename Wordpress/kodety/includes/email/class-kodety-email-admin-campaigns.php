<?php
/**
 * Telas de campanha: lista, editor e acompanhamento do envio.
 *
 * O autor dispara a campanha manualmente. A tela acompanha e acelera os ticks
 * enquanto está aberta; o WP-Cron apenas retoma uma fila já iniciada.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Admin_Campaigns {
    public static function render(): void {
        if (!current_user_can(Kodety_Email_Schema::CAP_VIEW)) return;

        $campaign_id = absint($_GET['campaign'] ?? 0);
        if ($campaign_id > 0) {
            $campaign = Kodety_Email_Campaigns::get($campaign_id);
            if ($campaign) {
                self::render_single($campaign);
                return;
            }
        }
        self::render_index();
    }

    private static function render_index(): void {
        $search = sanitize_text_field((string) wp_unslash($_GET['campaign_search'] ?? ''));
        $status = sanitize_key((string) wp_unslash($_GET['campaign_status'] ?? ''));
        $page = max(1, absint($_GET['campaign_page'] ?? 1));
        $pagination = self::paginate_campaigns([
            'search' => $search,
            'status' => $status,
            'page' => $page,
            'per_page' => 25,
        ]);
        $campaigns = $pagination['items'];
        $can_manage = current_user_can(Kodety_Email_Schema::CAP_MANAGE);
        $rows = [];
        $overview = self::campaign_overview();
        $totals = $overview['totals'];
        $status_counts = $overview['statuses'];
        $reports = Kodety_Email_Campaigns::reports(array_map(
            static fn(array $campaign): int => (int) $campaign['id'],
            $campaigns
        ));
        $empty_report = [
            'sent' => 0, 'failed' => 0, 'skipped' => 0,
            'opens' => 0, 'clicks' => 0, 'bounces' => 0, 'unsubscribes' => 0,
            'open_rate' => 0.0, 'click_rate' => 0.0,
        ];

        foreach ($campaigns as $campaign) {
            $report = $reports[(int) $campaign['id']] ?? $empty_report;
            $rows[] = ['campaign' => $campaign, 'report' => $report];
        }

        $open_rate = $totals['sent'] > 0 ? round($totals['opens'] / $totals['sent'] * 100, 1) : 0.0;
        $click_rate = $totals['sent'] > 0 ? round($totals['clicks'] / $totals['sent'] * 100, 1) : 0.0;
        $templates_count = self::templates_count();
        $lists_count = count(Kodety_Email_Contacts::lists());
        $has_filters = $search !== '' || $status !== '';
        ?>
        <div class="wrap kodety-emails kodety-email-marketing">
            <?php Kodety_Email_Admin::header('Campanhas', 'Crie o email, escolha as listas e dispare.', 'campaigns'); ?>
            <?php Kodety_Email_Admin::notices(); ?>

            <section class="kodety-overview-grid" aria-label="Resumo das campanhas">
                <?php foreach ([
                    ['Campanhas', $overview['total'], ($status_counts['draft'] ?? 0) . ' rascunho(s)', 'campaigns'],
                    ['Entregues', $totals['sent'], ($status_counts['sending'] ?? 0) . ' em envio', 'sent'],
                    ['Abertura', $open_rate . '%', Kodety_Admin_I18n::instance()->format_number($totals['opens']) . ' contato(s)', 'opens'],
                    ['Cliques', $click_rate . '%', Kodety_Admin_I18n::instance()->format_number($totals['clicks']) . ' contato(s)', 'clicks'],
                ] as [$label, $value, $detail, $kind]): ?>
                    <article class="kodety-overview-card is-<?php echo esc_attr($kind); ?>">
                        <span><?php echo esc_html($label); ?></span>
                        <strong><?php echo esc_html(is_int($value) ? Kodety_Admin_I18n::instance()->format_number($value) : $value); ?></strong>
                        <small><?php echo esc_html($detail); ?></small>
                    </article>
                <?php endforeach; ?>
            </section>

            <div class="kodety-campaign-index-layout <?php echo $can_manage ? '' : 'is-readonly'; ?>">
                <?php if ($can_manage): ?>
                    <form class="kodety-create-card" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                        <input type="hidden" name="action" value="kodety_email_create_campaign">
                        <?php wp_nonce_field('kodety_email_create_campaign'); ?>
                        <div>
                            <p class="kodety-eyebrow">Começar</p>
                            <h2>Nova campanha</h2>
                            <p>Dê um nome interno. Assunto, conteúdo e público vêm na próxima etapa.</p>
                        </div>
                        <label>
                            <span>Nome interno</span>
                            <input type="text" name="name" required autocomplete="off" placeholder="Ex.: Newsletter de julho">
                        </label>
                        <button class="button button-primary">Criar e configurar</button>
                    </form>
                <?php endif; ?>

                <aside class="kodety-quick-actions" aria-label="Atalhos de preparação">
                    <p class="kodety-eyebrow">Preparação</p>
                    <a href="<?php echo esc_url(admin_url('admin.php?page=' . Kodety_Email_Marketing::PAGE_TEMPLATES)); ?>">
                        <span>Templates</span>
                        <strong><?php echo Kodety_Admin_I18n::instance()->format_number($templates_count); ?></strong>
                        <small>conteúdo pronto para usar</small>
                    </a>
                    <a href="<?php echo esc_url(admin_url('admin.php?page=' . Kodety_Email_Marketing::PAGE_LISTS)); ?>">
                        <span>Listas</span>
                        <strong><?php echo Kodety_Admin_I18n::instance()->format_number($lists_count); ?></strong>
                        <small>grupos de destinatários</small>
                    </a>
                </aside>
            </div>

            <?php if ($overview['total'] === 0): ?>
                <section class="kodety-empty-state">
                    <span class="kodety-empty-state__icon" aria-hidden="true">↗</span>
                    <h2>Nenhuma campanha ainda</h2>
                    <p>Crie um rascunho, associe um template e escolha as listas que receberão o email.</p>
                </section>
            <?php else: ?>
                <section class="kodety-content-section">
                    <header class="kodety-section-heading">
                        <div>
                            <p class="kodety-eyebrow">Histórico</p>
                            <h2><?php echo Kodety_Admin_I18n::instance()->format_number($pagination['total']); ?> campanha(s)</h2>
                            <p>Resultados consolidados e estado atual de cada disparo. Métricas de interação respeitam a retenção configurada.</p>
                        </div>
                        <form class="kodety-table-toolbar" method="get" action="<?php echo esc_url(admin_url('admin.php')); ?>">
                            <input type="hidden" name="page" value="<?php echo esc_attr(Kodety_Email_Marketing::PAGE_CAMPAIGNS); ?>">
                            <label class="kodety-table-search">
                                <span class="screen-reader-text">Buscar campanha</span>
                                <input type="search" name="campaign_search" value="<?php echo esc_attr($search); ?>"
                                       placeholder="Buscar campanha…">
                            </label>
                            <label>
                                <span class="screen-reader-text">Filtrar por status</span>
                                <select name="campaign_status">
                                    <option value="">Todos os status</option>
                                    <option value="draft" <?php selected($status, 'draft'); ?>>Rascunhos</option>
                                    <option value="sending" <?php selected($status, 'sending'); ?>>Em envio</option>
                                    <option value="paused" <?php selected($status, 'paused'); ?>>Pausadas</option>
                                    <option value="sent" <?php selected($status, 'sent'); ?>>Enviadas</option>
                                    <option value="failed" <?php selected($status, 'failed'); ?>>Com falha</option>
                                </select>
                            </label>
                            <button class="button">Filtrar</button>
                            <?php if ($has_filters): ?>
                                <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=' . Kodety_Email_Marketing::PAGE_CAMPAIGNS)); ?>">Limpar</a>
                            <?php endif; ?>
                        </form>
                    </header>
                    <?php if (!$rows): ?>
                        <div class="kodety-empty-state is-compact">
                            <h3>Nenhuma campanha corresponde aos filtros</h3>
                            <p>Altere a busca ou limpe os filtros para voltar ao histórico completo.</p>
                            <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=' . Kodety_Email_Marketing::PAGE_CAMPAIGNS)); ?>">Limpar filtros</a>
                        </div>
                    <?php else: ?>
                        <div class="kodety-email-table">
                        <table>
                            <thead><tr><th>Campanha</th><th>Status</th><th>Enviados</th><th>Aberturas</th><th>Cliques</th><th>Data</th></tr></thead>
                            <tbody>
                                <?php foreach ($rows as $row):
                                    $campaign = $row['campaign'];
                                    $report = $row['report'];
                                    $url = add_query_arg([
                                        'page' => Kodety_Email_Marketing::PAGE_CAMPAIGNS,
                                        'campaign' => (int) $campaign['id'],
                                    ], admin_url('admin.php'));
                                    ?>
                                    <tr>
                                        <td>
                                            <a class="kodety-email-preview" href="<?php echo esc_url($url); ?>">
                                                <strong><?php echo esc_html($campaign['name']); ?></strong>
                                                <span><?php echo esc_html($campaign['subject'] !== '' ? $campaign['subject'] : 'sem assunto'); ?></span>
                                            </a>
                                        </td>
                                        <td><span class="kodety-campaign-status is-<?php echo esc_attr($campaign['status']); ?>"><?php echo esc_html(self::status_label((string) $campaign['status'])); ?></span></td>
                                        <td><?php echo Kodety_Admin_I18n::instance()->format_number($report['sent']); ?></td>
                                        <td><?php echo esc_html($report['open_rate']); ?>%</td>
                                        <td><?php echo esc_html($report['click_rate']); ?>%</td>
                                        <td>
                                            <?php if ($campaign['status'] === 'scheduled' && !empty($campaign['scheduled_at'])): ?>
                                                <span class="kodety-table-date is-scheduled">Agendada</span>
                                                <?php echo esc_html(Kodety_Admin_I18n::instance()->format_mysql_gmt((string) $campaign['scheduled_at'])); ?>
                                            <?php else: ?>
                                                <?php echo esc_html(Kodety_Admin_I18n::instance()->format_mysql_gmt((string) $campaign['created_at'], 'short_date')); ?>
                                            <?php endif; ?>
                                        </td>
                                    </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                        </div>
                        <?php self::render_pagination(
                            $pagination,
                            [
                                'page' => Kodety_Email_Marketing::PAGE_CAMPAIGNS,
                                'campaign_search' => $search,
                                'campaign_status' => $status,
                            ],
                            'campaign_page'
                        ); ?>
                    <?php endif; ?>
                </section>
            <?php endif; ?>
        </div>
        <?php
    }

    private static function render_single(array $campaign): void {
        $id = (int) $campaign['id'];
        $can_manage = current_user_can(Kodety_Email_Schema::CAP_MANAGE);
        $editable = Kodety_Email_Campaigns::is_editable($campaign);
        $expected_revision = Kodety_Email_Campaigns::campaign_revision($campaign);
        $recovered_conflict = false;
        $done = sanitize_key((string) wp_unslash($_GET['done'] ?? ''));
        if ($can_manage && $editable && $done === 'campaign_conflict') {
            $recovery = Kodety_Email_Campaigns::consume_draft_recovery($id);
            if (is_array($recovery)) {
                foreach (['name', 'subject', 'preheader', 'template_id'] as $field) {
                    if (array_key_exists($field, $recovery)) $campaign[$field] = $recovery[$field];
                }
                $campaign['audience']['list_ids'] = (array) ($recovery['list_ids'] ?? []);
                $recovered_conflict = true;
            }
        }
        $lists = Kodety_Email_Contacts::lists();
        $templates = Kodety_Email_Campaigns::templates();
        $selected = (array) ($campaign['audience']['list_ids'] ?? []);
        $issues = Kodety_Email_Renderer::lint($campaign);
        $audience_summary = Kodety_Email_Campaigns::audience_summary($selected);
        $audience_size = (int) $audience_summary['total'];
        $audience_signature = (string) $audience_summary['signature'];
        $progress = Kodety_Email_Queue::progress($id);
        $report = Kodety_Email_Campaigns::report($id);
        $campaign_stats = json_decode((string) ($campaign['stats_json'] ?? ''), true);
        $ack_reconciliation = Kodety_Email_Campaigns::transport_ack_reconciliation($campaign);
        $delivery_pause = $campaign['status'] === 'paused'
            && is_array($campaign_stats)
            && (string) ($campaign_stats['pause_reason'] ?? '') === 'delivery_configuration_changed';
        $running = in_array($campaign['status'], ['sending', 'paused'], true);
        $is_scheduled = $campaign['status'] === 'scheduled';
        if ($is_scheduled && (int) $progress['total'] > 0) {
            $audience_size = (int) $progress['total'];
        }
        // Editar uma campanha já enviada mudaria o registro do que foi enviado
        // sem mudar nada do que chegou às caixas — então os campos travam.
        $can_edit = $can_manage && $editable;
        $health = Kodety_Email_Health::report();
        $selected_template_name = 'Nenhum template';
        foreach ($templates as $template) {
            if ((int) $template['id'] === (int) $campaign['template_id']) {
                $selected_template_name = (string) $template['name'];
                break;
            }
        }
        $blocking = Kodety_Email_Renderer::has_blocking_issue($issues);
        $error_count = count(array_filter($issues, static fn(array $issue): bool => $issue['level'] === 'error'));
        $warning_count = count($issues) - $error_count;
        $progress_percent = $progress['total'] > 0 ? (int) round($progress['sent'] / $progress['total'] * 100) : 0;
        ?>
        <div class="wrap kodety-emails kodety-email-marketing">
            <?php Kodety_Email_Admin::header($campaign['name'], 'Campanha ' . self::status_label((string) $campaign['status']) . '.', 'campaigns'); ?>
            <?php Kodety_Email_Admin::notices(); ?>

            <div class="kodety-campaign-toolbar">
                <a class="kodety-email-back" href="<?php echo esc_url(admin_url('admin.php?page=' . Kodety_Email_Marketing::PAGE_CAMPAIGNS)); ?>"><span data-kodety-icon="arrow-left" data-kodety-icon-size="14" aria-hidden="true"></span><span><?php echo esc_html(Kodety_Admin_I18n::instance()->translate('Todas as campanhas')); ?></span></a>

                <?php if ($can_manage): ?>
                    <div class="kodety-campaign-toolbar__actions">
                        <?php if ($is_scheduled): ?>
                            <?php self::action_button($id, 'kodety_email_cancel_schedule', 'Cancelar agendamento', 'button'); ?>
                        <?php endif; ?>
                        <?php self::action_button($id, 'kodety_email_duplicate_campaign', 'Duplicar campanha', 'button button-primary'); ?>
                        <?php if (!$running): ?>
                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"
                                  onsubmit="return confirm('Apagar esta campanha? O relatório e a fila também somem.');">
                                <input type="hidden" name="action" value="kodety_email_delete_campaign">
                                <input type="hidden" name="campaign_id" value="<?php echo absint($id); ?>">
                                <?php wp_nonce_field('kodety_email_delete_campaign'); ?>
                                <button class="button kodety-button-danger">Apagar</button>
                            </form>
                        <?php endif; ?>
                    </div>
                <?php endif; ?>
            </div>

            <?php if ($is_scheduled): ?>
                <p class="kodety-campaign-locked is-scheduled">
                    Esta campanha veio de uma versão anterior com agendamento.
                    O Onun Kodety agora trabalha somente com envio manual. Cancele o agendamento para revisar e usar <strong>Enviar agora</strong>.
                </p>
            <?php elseif (!$editable && !$running): ?>
                <p class="kodety-campaign-locked">
                    Esta campanha já foi enviada, então os campos abaixo ficam travados como registro do que saiu.
                    Para mandar de novo, use <strong>Duplicar campanha</strong> — a cópia nasce como rascunho editável.
                </p>
            <?php endif; ?>

            <?php if ($running || $campaign['status'] === 'sent'): ?>
                <section class="kodety-send-progress"
                         aria-labelledby="kodety-send-progress-title"
                         data-kodety-campaign="<?php echo absint($id); ?>"
                         data-kodety-status="<?php echo esc_attr($campaign['status']); ?>"
                         data-kodety-tick="<?php echo esc_url(rest_url('kodety/v1/email/campaigns/' . $id . '/tick')); ?>"
                         data-kodety-nonce="<?php echo esc_attr(wp_create_nonce('wp_rest')); ?>">
                    <header>
                        <div>
                            <p class="kodety-eyebrow">Envio</p>
                            <h2 id="kodety-send-progress-title" data-kodety-progress-label>
                                <?php echo Kodety_Admin_I18n::instance()->format_number($progress['sent']); ?> de <?php echo Kodety_Admin_I18n::instance()->format_number($progress['total']); ?> enviados
                            </h2>
                        </div>
                        <?php if ($can_manage && $running): ?>
                            <div class="kodety-send-progress__actions">
                                <?php if ($ack_reconciliation): ?>
                                    <?php if ((int) $ack_reconciliation['queue_id'] > 0): ?>
                                        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"
                                              onsubmit="return window.confirm(<?php echo esc_attr(wp_json_encode(
                                                  'O provedor já aceitou esta mensagem. Confirmar registra a fila como entrega incerta e terminal, sem reenviá-la, e retoma apenas os outros destinatários.'
                                              )); ?>);">
                                            <input type="hidden" name="action" value="kodety_email_reconcile_campaign_ack">
                                            <input type="hidden" name="campaign_id" value="<?php echo absint($id); ?>">
                                            <input type="hidden" name="queue_id" value="<?php echo absint($ack_reconciliation['queue_id']); ?>">
                                            <?php wp_nonce_field('kodety_email_reconcile_campaign_ack'); ?>
                                            <button class="button button-primary">Registrar entrega incerta e continuar</button>
                                        </form>
                                    <?php endif; ?>
                                <?php else: ?>
                                    <?php self::action_button($id, $campaign['status'] === 'paused' ? 'kodety_email_resume_campaign' : 'kodety_email_pause_campaign',
                                        $campaign['status'] === 'paused'
                                            ? ($delivery_pause ? 'Aplicar configuração e retomar' : 'Retomar envio')
                                            : 'Pausar',
                                        'button'); ?>
                                <?php endif; ?>
                            </div>
                        <?php endif; ?>
                    </header>
                    <div class="kodety-progress-bar" role="progressbar" aria-label="Progresso do envio"
                         aria-valuemin="0" aria-valuemax="100" aria-valuenow="<?php echo esc_attr((string) $progress_percent); ?>"
                         data-kodety-progress-track>
                        <span data-kodety-progress-bar style="width:<?php echo esc_attr((string) $progress_percent); ?>%"></span>
                    </div>
                    <p class="kodety-send-progress__meta" data-kodety-progress-meta role="status" aria-live="polite">
                        <?php if ($ack_reconciliation): ?>
                            <strong>Retomada bloqueada para evitar envio duplicado.</strong>
                            O provedor aceitou a mensagem da fila
                            #<?php echo Kodety_Admin_I18n::instance()->format_number((int) $ack_reconciliation['queue_id']); ?>,
                            mas o banco não conseguiu registrar a confirmação. Verifique o provedor se necessário e use
                            <strong>Registrar entrega incerta e continuar</strong>: essa linha vira terminal e somente os demais destinatários são retomados.
                            <?php if ((int) $ack_reconciliation['queue_id'] <= 0): ?>
                                A referência da fila está incompleta; duplique a campanha para um novo disparo ou procure suporte antes de continuar.
                            <?php endif; ?>
                        <?php elseif ($delivery_pause): ?>
                            A configuração de transporte mudou durante a campanha. A fila foi pausada antes do próximo destinatário.
                            Ao retomar, a configuração atual será aplicada aos próximos envios. Você pode consultar as recomendações em
                            <a href="<?php echo esc_url(admin_url('admin.php?page=' . Kodety_Email_Marketing::PAGE_HEALTH)); ?>">Saúde de entrega</a>.
                        <?php elseif ($campaign['status'] === 'paused'): ?>
                            Envio pausado. Clique em retomar para continuar.
                        <?php elseif ($progress['pending'] > 0): ?>
                            A fila continua em segundo plano; esta tela também acompanha e antecipa o progresso.
                        <?php else: ?>
                            Envio concluído.
                        <?php endif; ?>
                    </p>
                </section>
            <?php endif; ?>

            <div class="kodety-campaign-report">
                <?php foreach ([
                    ['Enviados', Kodety_Admin_I18n::instance()->format_number($report['sent']), 'sent'],
                    ['Aberturas', $report['open_rate'] . '%', 'opens'],
                    ['Cliques', $report['click_rate'] . '%', 'clicks'],
                    ['Bounces', Kodety_Admin_I18n::instance()->format_number($report['bounces']), 'bounces'],
                    ['Descadastros', Kodety_Admin_I18n::instance()->format_number($report['unsubscribes']), 'unsubscribes'],
                ] as [$label, $value, $kind]): ?>
                    <div class="is-<?php echo esc_attr($kind); ?>"><span><?php echo esc_html($label); ?></span><strong><?php echo esc_html($value); ?></strong></div>
                <?php endforeach; ?>
            </div>

            <div class="kodety-campaign-workspace">
                <div class="kodety-campaign-workspace__main">
                    <form class="kodety-email-settings kodety-campaign-form" method="post"
                          action="<?php echo esc_url(admin_url('admin-post.php')); ?>" data-kodety-campaign-form
                          data-kodety-recovered="<?php echo $recovered_conflict ? '1' : '0'; ?>">
                        <input type="hidden" name="action" value="kodety_email_save_campaign">
                        <input type="hidden" name="campaign_id" value="<?php echo absint($id); ?>">
                        <input type="hidden" name="expected_revision" value="<?php echo esc_attr($expected_revision); ?>">
                        <?php wp_nonce_field('kodety_email_save_campaign'); ?>

                        <section id="kodety-campaign-content" data-kodety-campaign-panel="content">
                            <header>
                                <div class="kodety-section-step" aria-hidden="true">1</div>
                                <div>
                                    <h2>Conteúdo</h2>
                                    <p>Defina o que aparece na caixa de entrada e escolha o template do email.</p>
                                </div>
                            </header>
                            <div class="kodety-email-grid">
                                <label>
                                    <span>Nome interno</span>
                                    <input name="name" value="<?php echo esc_attr($campaign['name']); ?>" <?php disabled(!$can_edit); ?>>
                                    <small>Só aparece para sua equipe.</small>
                                </label>
                                <label>
                                    <span>Assunto</span>
                                    <input name="subject" value="<?php echo esc_attr($campaign['subject']); ?>"
                                           placeholder="Novidades de julho, {{contact.first_name}}" <?php disabled(!$can_edit); ?>>
                                    <small>Aceita merge tags, como <code>{{contact.first_name}}</code>.</small>
                                </label>
                                <label class="is-wide">
                                    <span>Texto de prévia (preheader)</span>
                                    <input name="preheader" value="<?php echo esc_attr($campaign['preheader']); ?>"
                                           placeholder="Completa o assunto na caixa de entrada." <?php disabled(!$can_edit); ?>>
                                </label>
                                <label class="is-wide">
                                    <span>Template</span>
                                    <select name="template_id" <?php disabled(!$can_edit); ?>>
                                        <option value="0">Nenhum template</option>
                                        <?php foreach ($templates as $template): ?>
                                            <option value="<?php echo absint($template['id']); ?>" <?php selected((int) $campaign['template_id'], (int) $template['id']); ?>>
                                                <?php echo esc_html($template['name']); ?>
                                            </option>
                                        <?php endforeach; ?>
                                    </select>
                                    <small>
                                        O construtor exporta HTML com CSS inline.
                                        <a href="<?php echo esc_url(admin_url('admin.php?page=' . Kodety_Email_Marketing::PAGE_TEMPLATES)); ?>">Gerenciar templates</a>
                                    </small>
                                </label>
                            </div>
                        </section>

                        <section id="kodety-campaign-audience" data-kodety-campaign-panel="audience">
                            <header>
                                <div class="kodety-section-step" aria-hidden="true">2</div>
                                <div>
                                    <h2>Destinatários</h2>
                                    <p>Selecione uma ou mais listas. Contatos repetidos entram apenas uma vez.</p>
                                </div>
                            </header>
                            <div class="kodety-audience-picker">
                                <?php if (!$lists): ?>
                                    <div class="kodety-audience-picker__empty">
                                        <strong>Nenhuma lista disponível</strong>
                                        <span>Crie uma lista antes de preparar o envio.</span>
                                        <?php if ($can_manage): ?>
                                            <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=' . Kodety_Email_Marketing::PAGE_LISTS)); ?>">Criar lista</a>
                                        <?php endif; ?>
                                    </div>
                                <?php endif; ?>
                                <?php foreach ($lists as $list): ?>
                                    <label class="kodety-audience-option">
                                        <input type="checkbox" name="list_ids[]" value="<?php echo absint($list['id']); ?>"
                                            <?php checked(in_array((int) $list['id'], array_map('intval', $selected), true)); ?>
                                            <?php disabled(!$can_edit); ?>>
                                        <span>
                                            <strong><?php echo esc_html($list['name']); ?></strong>
                                            <small><?php echo Kodety_Admin_I18n::instance()->format_number((int) $list['subscriber_count']); ?> inscritos ativos</small>
                                        </span>
                                    </label>
                                <?php endforeach; ?>
                                <p class="kodety-audience-total" data-kodety-saved-audience>
                                    Alcance salvo: <strong><?php echo Kodety_Admin_I18n::instance()->format_number($audience_size); ?></strong> contatos
                                    <small>Descadastrados e endereços suprimidos são excluídos automaticamente.</small>
                                </p>
                            </div>
                        </section>

                        <section id="kodety-campaign-planning" data-kodety-campaign-panel="planning">
                            <header>
                                <div class="kodety-section-step" aria-hidden="true">3</div>
                                <div>
                                    <h2>Entrega</h2>
                                    <p>O envio começa somente depois da confirmação manual em “Enviar agora”.</p>
                                </div>
                            </header>
                            <div class="kodety-delivery-grid">
                                <div class="kodety-campaign-plan is-current">
                                    <span class="kodety-campaign-plan__icon" data-kodety-icon="arrow-right" aria-hidden="true"></span>
                                    <div>
                                        <strong>Enviar quando quiser</strong>
                                        <p>Salve o rascunho e use “Enviar agora” na revisão. Conteúdo, entrega e alcance são revalidados antes de a fila começar.</p>
                                    </div>
                                    <span class="kodety-email-pill">Manual</span>
                                </div>
                                <p class="kodety-manual-delivery-summary">
                                    Nada é enviado ao salvar. O clique manual cria uma fotografia dos destinatários elegíveis,
                                    exclui descadastros e supressões e inicia a fila em lotes seguros.
                                </p>
                            </div>
                        </section>

                        <?php if ($can_edit): ?>
                            <div class="kodety-email-settings__save">
                                <p>Salve para atualizar a revisão, a prévia e a contagem de destinatários.</p>
                                <div class="kodety-email-settings__actions">
                                    <button class="button" data-kodety-campaign-save>Salvar rascunho</button>
                                </div>
                            </div>
                        <?php endif; ?>
                    </form>
                </div>

                <aside class="kodety-campaign-workspace__aside">
                    <section class="kodety-review-card" aria-labelledby="kodety-review-title">
                        <header>
                            <div>
                                <p class="kodety-eyebrow">Antes de enviar</p>
                                <h2 id="kodety-review-title">Revisão</h2>
                            </div>
                            <span class="kodety-review-state is-<?php echo $blocking ? 'blocked' : 'ready'; ?>">
                                <?php echo $blocking ? esc_html($error_count . ' erro(s)') : 'Pronta'; ?>
                            </span>
                        </header>

                        <div class="kodety-campaign-dirty" data-kodety-campaign-dirty role="status" aria-live="polite" hidden>
                            <strong>Alterações ainda não salvas</strong>
                            <span>Salve a campanha antes de enviar um teste ou iniciar o disparo.</span>
                        </div>

                        <dl class="kodety-review-summary">
                            <div>
                                <dt>Template</dt>
                                <dd><?php echo esc_html($selected_template_name); ?></dd>
                            </div>
                            <div>
                                <dt>Público elegível agora</dt>
                                <dd><?php echo Kodety_Admin_I18n::instance()->format_number($audience_size); ?> contatos</dd>
                            </div>
                            <div>
                                <dt>Entrega</dt>
                                <dd class="is-<?php echo !empty($health['optimized']) ? 'ok' : 'warning'; ?>">
                                    Saúde <?php echo Kodety_Admin_I18n::instance()->format_number((int) $health['score']); ?>/100
                                </dd>
                            </div>
                            <div>
                                <dt>Validação</dt>
                                <dd><?php echo Kodety_Admin_I18n::instance()->format_number($error_count); ?> erro(s), <?php echo Kodety_Admin_I18n::instance()->format_number($warning_count); ?> aviso(s)</dd>
                            </div>
                        </dl>

                        <div class="kodety-lint">
                            <?php if (!$issues): ?>
                                <p class="kodety-lint__ok">Nenhum problema encontrado no conteúdo salvo.</p>
                            <?php endif; ?>
                            <?php foreach ($issues as $issue): ?>
                                <p class="kodety-lint__item is-<?php echo esc_attr($issue['level']); ?>">
                                    <span><?php echo $issue['level'] === 'error' ? 'erro' : 'aviso'; ?></span>
                                    <?php echo esc_html($issue['message']); ?>
                                </p>
                            <?php endforeach; ?>
                        </div>

                        <?php if ($can_edit): ?>
                            <div class="kodety-send-actions">
                                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"
                                      class="kodety-send-actions__test" data-kodety-requires-saved-form>
                                    <input type="hidden" name="action" value="kodety_email_test_campaign">
                                    <input type="hidden" name="campaign_id" value="<?php echo absint($id); ?>">
                                    <input type="hidden" name="expected_revision" value="<?php echo esc_attr($expected_revision); ?>">
                                    <?php wp_nonce_field('kodety_email_test_campaign'); ?>
                                    <label>
                                        <span>Email de teste</span>
                                        <input type="email" name="test_email" required value="<?php echo esc_attr(wp_get_current_user()->user_email); ?>">
                                    </label>
                                    <button class="button" data-kodety-requires-saved>Enviar teste</button>
                                </form>

                                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"
                                      data-kodety-requires-saved-form
                                      data-kodety-blocked="<?php echo esc_attr($blocking
                                          ? 'Corrija os erros da revisão antes de enviar.'
                                          : ($audience_size === 0 ? 'Selecione uma lista com ao menos um contato elegível antes de enviar.' : '')); ?>"
                                      data-kodety-confirm="<?php echo esc_attr('Disparar para ' . $audience_size . ' contatos? Isso não pode ser desfeito.'); ?>">
                                    <input type="hidden" name="action" value="kodety_email_send_campaign">
                                    <input type="hidden" name="campaign_id" value="<?php echo absint($id); ?>">
                                    <input type="hidden" name="expected_revision" value="<?php echo esc_attr($expected_revision); ?>">
                                    <input type="hidden" name="expected_audience_size" value="<?php echo absint($audience_size); ?>">
                                    <input type="hidden" name="expected_audience_signature" value="<?php echo esc_attr($audience_signature); ?>">
                                    <?php wp_nonce_field('kodety_email_send_campaign'); ?>
                                    <button class="button button-primary button-hero" data-kodety-requires-saved
                                            <?php if ($blocking || $audience_size === 0): ?>aria-disabled="true"<?php endif; ?>>
                                        Enviar agora para <?php echo Kodety_Admin_I18n::instance()->format_number($audience_size); ?>
                                    </button>
                                </form>
                                <?php if ($blocking || $audience_size === 0): ?>
                                    <p class="kodety-send-actions__note is-blocked" role="status">
                                        <?php echo esc_html($blocking
                                            ? 'O botão mostra o motivo do bloqueio até os erros da revisão serem corrigidos.'
                                            : 'Adicione contatos elegíveis a uma das listas selecionadas para liberar o disparo.'); ?>
                                    </p>
                                <?php endif; ?>
                                <p class="kodety-send-actions__note">O disparo em massa não pode ser desfeito depois da confirmação.</p>
                            </div>
                        <?php endif; ?>
                    </section>
                </aside>
            </div>

            <?php if (trim((string) $campaign['html']) !== ''): ?>
                <section class="kodety-email-settings">
                    <section>
                        <header>
                            <h2>Pré-visualização</h2>
                            <p>Renderizada num iframe isolado a partir da última versão salva.</p>
                        </header>
                        <iframe class="kodety-preview-frame" title="Pré-visualização do email"
                                sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"
                                srcdoc="<?php echo esc_attr((string) $campaign['html']); ?>"></iframe>
                    </section>
                </section>
            <?php endif; ?>
        </div>
        <?php
    }

    /**
     * Paginação e filtros rodam no banco. A busca local antiga só enxergava
     * as primeiras 200 campanhas e fazia a UI afirmar que aquele recorte era
     * o histórico completo.
     *
     * @return array{items:array,total:int,page:int,pages:int,per_page:int}
     */
    private static function paginate_campaigns(array $args): array {
        global $wpdb;

        $table = Kodety_Email_Schema::table('campaigns');
        $search = sanitize_text_field((string) ($args['search'] ?? ''));
        $status = sanitize_key((string) ($args['status'] ?? ''));
        $page = max(1, absint($args['page'] ?? 1));
        $per_page = max(10, min(100, absint($args['per_page'] ?? 25)));
        $where = ['1 = 1'];
        $params = [];

        if ($search !== '') {
            $like = '%' . $wpdb->esc_like($search) . '%';
            $where[] = '(name LIKE %s OR subject LIKE %s)';
            $params[] = $like;
            $params[] = $like;
        }
        if (in_array($status, Kodety_Email_Schema::CAMPAIGN_STATUSES, true)) {
            $where[] = 'status = %s';
            $params[] = $status;
        }

        $where_sql = implode(' AND ', $where);
        $count_sql = "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}";
        if ($params) $count_sql = $wpdb->prepare($count_sql, ...$params);
        $total = (int) $wpdb->get_var($count_sql);
        $pages = max(1, (int) ceil($total / $per_page));
        $page = min($page, $pages);
        $offset = ($page - 1) * $per_page;

        $items_sql = "SELECT id, name, subject, status, scheduled_at, created_at
                      FROM {$table}
                      WHERE {$where_sql}
                      ORDER BY created_at DESC, id DESC
                      LIMIT %d OFFSET %d";
        $items_params = array_merge($params, [$per_page, $offset]);
        $items = $wpdb->get_results($wpdb->prepare($items_sql, ...$items_params), ARRAY_A);

        return [
            'items' => is_array($items) ? $items : [],
            'total' => $total,
            'page' => $page,
            'pages' => $pages,
            'per_page' => $per_page,
        ];
    }

    /**
     * KPIs globais em consultas fixas, sem carregar o histórico inteiro.
     * O snapshot final mantém a quantidade enviada mesmo depois da limpeza da
     * fila; eventos preservam abertura e clique durante a retenção escolhida.
     *
     * @return array{total:int,statuses:array<string,int>,totals:array{sent:int,opens:int,clicks:int}}
     */
    private static function campaign_overview(): array {
        global $wpdb;

        $campaigns = Kodety_Email_Schema::table('campaigns');
        $queue = Kodety_Email_Schema::table('queue');
        $events = Kodety_Email_Schema::table('events');
        $statuses = [];
        $status_rows = $wpdb->get_results(
            "SELECT status, COUNT(*) total FROM {$campaigns} GROUP BY status",
            ARRAY_A
        );
        foreach (is_array($status_rows) ? $status_rows : [] as $row) {
            $statuses[(string) $row['status']] = (int) $row['total'];
        }

        $totals = get_transient('kodety_email_campaign_overview_v1');
        if (!is_array($totals)) {
            $by_campaign = [];
            $stats_rows = $wpdb->get_results(
                "SELECT id, stats_json FROM {$campaigns} WHERE stats_json IS NOT NULL",
                ARRAY_A
            );
            foreach (is_array($stats_rows) ? $stats_rows : [] as $row) {
                $id = (int) $row['id'];
                $stats = json_decode((string) $row['stats_json'], true);
                $by_campaign[$id] = [
                    'stats_sent' => is_array($stats) ? (int) ($stats['sent'] ?? 0) : 0,
                    'queue_sent' => 0,
                    'event_sent' => 0,
                    'opens' => 0,
                    'clicks' => 0,
                ];
            }
            $queue_rows = $wpdb->get_results(
                "SELECT campaign_id, COUNT(*) total
                 FROM {$queue}
                 WHERE status = 'sent'
                 GROUP BY campaign_id",
                ARRAY_A
            );
            foreach (is_array($queue_rows) ? $queue_rows : [] as $row) {
                $id = (int) $row['campaign_id'];
                $by_campaign[$id] ??= [
                    'stats_sent' => 0, 'queue_sent' => 0, 'event_sent' => 0,
                    'opens' => 0, 'clicks' => 0,
                ];
                $by_campaign[$id]['queue_sent'] = (int) $row['total'];
            }
            $event_rows = $wpdb->get_results(
                "SELECT campaign_id, type, COUNT(DISTINCT contact_id) total
                 FROM {$events}
                 WHERE type IN ('sent', 'open', 'click')
                 GROUP BY campaign_id, type",
                ARRAY_A
            );
            foreach (is_array($event_rows) ? $event_rows : [] as $row) {
                $id = (int) $row['campaign_id'];
                $by_campaign[$id] ??= [
                    'stats_sent' => 0, 'queue_sent' => 0, 'event_sent' => 0,
                    'opens' => 0, 'clicks' => 0,
                ];
                $field = match ((string) $row['type']) {
                    'sent' => 'event_sent',
                    'open' => 'opens',
                    'click' => 'clicks',
                    default => '',
                };
                if ($field !== '') $by_campaign[$id][$field] = (int) $row['total'];
            }

            $totals = ['sent' => 0, 'opens' => 0, 'clicks' => 0];
            foreach ($by_campaign as $metrics) {
                $totals['sent'] += max(
                    (int) $metrics['stats_sent'],
                    (int) $metrics['queue_sent'],
                    (int) $metrics['event_sent']
                );
                $totals['opens'] += (int) $metrics['opens'];
                $totals['clicks'] += (int) $metrics['clicks'];
            }
            $totals = [
                'sent' => (int) ($totals['sent'] ?? 0),
                'opens' => (int) ($totals['opens'] ?? 0),
                'clicks' => (int) ($totals['clicks'] ?? 0),
            ];
            set_transient('kodety_email_campaign_overview_v1', $totals, MINUTE_IN_SECONDS);
        }

        return [
            'total' => array_sum($statuses),
            'statuses' => $statuses,
            'totals' => [
                'sent' => (int) ($totals['sent'] ?? 0),
                'opens' => (int) ($totals['opens'] ?? 0),
                'clicks' => (int) ($totals['clicks'] ?? 0),
            ],
        ];
    }

    private static function templates_count(): int {
        global $wpdb;
        return (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM " . Kodety_Email_Schema::table('templates') . " WHERE kind = 'campaign'"
        );
    }

    /**
     * @param array{page:int,pages:int} $pagination
     * @param array<string,string> $query_args
     */
    private static function render_pagination(array $pagination, array $query_args, string $page_key): void {
        if ((int) $pagination['pages'] <= 1) return;

        $query_args = array_filter(
            $query_args,
            static fn(mixed $value): bool => (string) $value !== ''
        );
        $placeholder = 999999999;
        $query_args[$page_key] = $placeholder;
        $base = str_replace(
            (string) $placeholder,
            '%#%',
            add_query_arg($query_args, admin_url('admin.php'))
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
        <nav class="kodety-pagination" aria-label="Paginação das campanhas">
            <?php echo wp_kses_post(implode(' ', $links)); ?>
        </nav>
        <?php
    }

    private static function action_button(int $campaign_id, string $action, string $label, string $class): void {
        ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="<?php echo esc_attr($action); ?>">
            <input type="hidden" name="campaign_id" value="<?php echo absint($campaign_id); ?>">
            <?php wp_nonce_field($action); ?>
            <button class="<?php echo esc_attr($class); ?>"><?php echo esc_html($label); ?></button>
        </form>
        <?php
    }

    private static function status_label(string $status): string {
        return match ($status) {
            'sending' => 'enviando',
            'paused' => 'pausada',
            'sent' => 'enviada',
            'scheduled' => 'agendada',
            'failed' => 'falhou',
            default => 'rascunho',
        };
    }
}
