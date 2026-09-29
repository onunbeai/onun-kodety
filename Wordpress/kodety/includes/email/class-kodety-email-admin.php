<?php
/**
 * Telas do módulo de Email Marketing no wp-admin.
 *
 * Reusa as classes de emails.css (header, tabs, cards, grid de settings) para
 * o módulo nascer visualmente idêntico à tela de Emails, e só acrescenta o que
 * é novo em email-marketing.css.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Admin {
    public static function render_health(): void {
        if (!current_user_can(Kodety_Email_Schema::CAP_VIEW)) return;

        $report = Kodety_Email_Health::report();
        $settings = Kodety_Email_Settings::for_display();
        ?>
        <div class="wrap kodety-emails kodety-email-marketing">
            <?php self::header('Saúde de entrega', 'Recomendações para melhorar autenticação, reputação e chegada à caixa de entrada.', 'health'); ?>
            <?php self::notices(); ?>

            <section class="kodety-health-hero" aria-labelledby="kodety-health-title">
                <div class="kodety-health-score" data-status="<?php echo esc_attr(self::score_status($report['score'])); ?>">
                    <strong><?php echo absint($report['score']); ?></strong>
                    <span>de 100</span>
                </div>
                <div class="kodety-health-hero__body">
                    <p class="kodety-eyebrow">Domínio remetente</p>
                    <h2 id="kodety-health-title"><?php echo esc_html($report['domain'] !== '' ? $report['domain'] : 'não configurado'); ?></h2>
                    <p>
                        <?php if (!empty($report['optimized'])): ?>
                            Configuração recomendada atendida. O envio continua sujeito à aceitação do servidor destinatário.
                        <?php else: ?>
                            Há recomendações pendentes. Elas podem afetar a entrega ou a caixa de destino, mas não bloqueiam o envio manual.
                        <?php endif; ?>
                    </p>
                </div>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="kodety-health-hero__action">
                    <input type="hidden" name="action" value="kodety_email_recheck">
                    <?php wp_nonce_field('kodety_email_recheck'); ?>
                    <button class="button">Verificar novamente</button>
                </form>
            </section>

            <div class="kodety-health-checks">
                <?php foreach ($report['checks'] as $check): ?>
                    <article class="kodety-health-check is-<?php echo esc_attr($check['status']); ?>">
                        <header>
                            <span class="kodety-health-dot" aria-hidden="true"></span>
                            <strong><?php echo esc_html($check['label']); ?></strong>
                            <span class="kodety-health-badge"><?php echo esc_html(self::status_label($check['status'])); ?></span>
                        </header>
                        <p class="kodety-health-check__detail"><?php echo esc_html($check['detail']); ?></p>
                        <?php if ($check['fix'] !== ''): ?>
                            <p class="kodety-health-check__fix"><?php echo esc_html($check['fix']); ?></p>
                        <?php endif; ?>
                        <?php if (!empty($check['record'])): ?>
                            <?php self::dns_record($check['record']); ?>
                        <?php endif; ?>
                        <?php if ($check['id'] === 'dkim' && empty($settings['dkim_private_key_configured']) && current_user_can(Kodety_Email_Schema::CAP_MANAGE)): ?>
                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="kodety-health-check__action">
                                <input type="hidden" name="action" value="kodety_email_generate_dkim">
                                <?php wp_nonce_field('kodety_email_generate_dkim'); ?>
                                <button class="button button-primary">Gerar par de chaves DKIM</button>
                            </form>
                        <?php endif; ?>
                    </article>
                <?php endforeach; ?>
            </div>

            <?php if (current_user_can(Kodety_Email_Schema::CAP_MANAGE)): ?>
                <section class="kodety-email-settings kodety-health-test">
                    <section>
                        <header>
                            <h2>Enviar teste</h2>
                            <p>Depois de receber, abra o cabeçalho original da mensagem e confira <code>dkim=pass</code> e <code>spf=pass</code>. É a prova definitiva de que o domínio está autenticado.</p>
                        </header>
                        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="kodety-health-test__form">
                            <input type="hidden" name="action" value="kodety_email_send_test">
                            <?php wp_nonce_field('kodety_email_send_test'); ?>
                            <label>
                                <span>Enviar para</span>
                                <input type="email" name="test_email" required
                                       value="<?php echo esc_attr(wp_get_current_user()->user_email); ?>"
                                       placeholder="voce@empresa.com">
                                <small>Prefira uma caixa no Gmail ou Outlook — são os filtros mais rígidos.</small>
                            </label>
                            <button class="button button-primary">Enviar email de teste</button>
                        </form>
                    </section>
                </section>
            <?php endif; ?>
        </div>
        <?php
    }

    public static function render_settings(): void {
        if (!current_user_can(Kodety_Email_Schema::CAP_MANAGE)) return;

        $settings = Kodety_Email_Settings::for_display();
        $transport = (string) $settings['transport'];
        ?>
        <div class="wrap kodety-emails kodety-email-marketing">
            <?php self::header('Configurações de envio', 'Como este WordPress entrega os emails. Nenhum serviço externo envolvido.', 'settings'); ?>
            <?php self::notices(); ?>

            <nav class="kodety-settings-jump" aria-label="Atalhos das configurações">
                <a href="#kodety-settings-sender">Remetente</a>
                <a href="#kodety-settings-delivery">Entrega</a>
                <a href="#kodety-settings-smtp">SMTP</a>
                <a href="#kodety-settings-rate">Ritmo</a>
                <a href="#kodety-settings-tracking">Rastreamento</a>
                <a href="#kodety-settings-bounces">Retornos</a>
            </nav>

            <form class="kodety-email-settings" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="kodety_email_save_settings">
                <?php wp_nonce_field('kodety_email_save_settings'); ?>

                <section id="kodety-settings-sender">
                    <header>
                        <h2>Remetente</h2>
                        <p>Use um endereço do domínio do site. Enviar em nome de um domínio de terceiro é rejeitado por DMARC.</p>
                    </header>
                    <div class="kodety-email-grid">
                        <label>
                            <span>Nome do remetente</span>
                            <input name="from_name" value="<?php echo esc_attr($settings['from_name']); ?>" placeholder="Equipe Onun Kodety">
                        </label>
                        <label>
                            <span>Email do remetente</span>
                            <input type="email" name="from_email" value="<?php echo esc_attr($settings['from_email']); ?>" placeholder="contato@seudominio.com">
                        </label>
                        <label>
                            <span>Responder para</span>
                            <input type="email" name="reply_to" value="<?php echo esc_attr($settings['reply_to']); ?>">
                        </label>
                    </div>
                </section>

                <section id="kodety-settings-delivery">
                    <header>
                        <h2>Modo de entrega</h2>
                        <p>Os três modos são self-hosted: usam apenas o PHP e a infraestrutura de email que você já tem.</p>
                    </header>
                    <div class="kodety-transport-options">
                        <?php foreach (self::transport_catalog() as $option): ?>
                            <label class="kodety-transport-option <?php echo $transport === $option['id'] ? 'is-current' : ''; ?>">
                                <input type="radio" name="transport" value="<?php echo esc_attr($option['id']); ?>" <?php checked($transport, $option['id']); ?>>
                                <span>
                                    <strong><?php echo esc_html($option['label']); ?></strong>
                                    <small><?php echo esc_html($option['description']); ?></small>
                                    <?php if ($option['warning'] !== ''): ?>
                                        <em><?php echo esc_html($option['warning']); ?></em>
                                    <?php endif; ?>
                                </span>
                            </label>
                        <?php endforeach; ?>
                    </div>
                </section>

                <section id="kodety-settings-smtp" data-kodety-transport-panel="smtp">
                    <header>
                        <h2>Servidor SMTP</h2>
                        <p>Usado apenas no modo SMTP. São as credenciais do seu próprio servidor de email.</p>
                    </header>
                    <div class="kodety-email-grid">
                        <label>
                            <span>Host</span>
                            <input name="smtp_host" value="<?php echo esc_attr($settings['smtp_host']); ?>" placeholder="mail.seudominio.com">
                        </label>
                        <label>
                            <span>Porta</span>
                            <input type="number" min="1" max="65535" name="smtp_port" value="<?php echo absint($settings['smtp_port']); ?>">
                        </label>
                        <label>
                            <span>Criptografia</span>
                            <select name="smtp_secure">
                                <?php foreach (['tls' => 'STARTTLS (587)', 'ssl' => 'SSL/TLS (465)', 'none' => 'Nenhuma'] as $value => $label): ?>
                                    <option value="<?php echo esc_attr($value); ?>" <?php selected($settings['smtp_secure'], $value); ?>><?php echo esc_html($label); ?></option>
                                <?php endforeach; ?>
                            </select>
                        </label>
                        <label>
                            <span>Usuário</span>
                            <input name="smtp_username" value="<?php echo esc_attr($settings['smtp_username']); ?>" autocomplete="off">
                        </label>
                        <label class="is-wide">
                            <span>Senha</span>
                            <input type="password" name="smtp_password" value="" autocomplete="new-password"
                                   placeholder="<?php echo !empty($settings['smtp_password_configured']) ? 'Configurada — deixe vazio para manter' : 'Informe a senha'; ?>">
                            <small>A senha salva nunca é exibida novamente.</small>
                            <span><input type="checkbox" name="clear_smtp_password" value="1"> Remover senha salva</span>
                        </label>
                    </div>
                </section>

                <section id="kodety-settings-rate">
                    <header>
                        <h2>Ritmo de envio</h2>
                        <p>Os limites abaixo são aplicados pela fila. Para aquecer um domínio novo, comece baixo e aumente os valores manualmente conforme os resultados.</p>
                    </header>
                    <div class="kodety-email-grid">
                        <label>
                            <span>Emails por minuto</span>
                            <input type="number" min="1" max="3000" name="emails_per_minute" value="<?php echo absint($settings['emails_per_minute']); ?>">
                        </label>
                        <label>
                            <span>Emails por hora</span>
                            <input type="number" min="1" max="100000" name="emails_per_hour" value="<?php echo absint($settings['emails_per_hour']); ?>">
                        </label>
                        <label>
                            <span>Emails por lote</span>
                            <input type="number" min="1" max="200" name="batch_size" value="<?php echo absint($settings['batch_size']); ?>">
                            <small>Quantos são processados a cada ciclo. Valores altos podem estourar o tempo de execução do PHP.</small>
                        </label>
                        <?php // Mantém a preferência legada sem anunciar uma automação que ainda não existe. ?>
                        <input type="hidden" name="warmup_enabled" value="<?php echo !empty($settings['warmup_enabled']) ? '1' : '0'; ?>">
                        <div class="kodety-future-setting is-wide" role="note">
                            <span class="kodety-future-setting__badge">Ainda indisponível</span>
                            <div>
                                <strong>Aquecimento automático</strong>
                                <p>Esta versão não aumenta ou reduz limites sozinha. Use os três controles acima para fazer o aquecimento manual.</p>
                                <small>A preferência antiga foi preservada, mas não altera o envio.</small>
                            </div>
                        </div>
                    </div>
                </section>

                <section id="kodety-settings-tracking">
                    <header>
                        <h2>Rastreamento</h2>
                        <p>Aberturas usam um pixel; cliques passam por um redirecionamento assinado. Todo IP é armazenado apenas como hash.</p>
                    </header>
                    <div class="kodety-email-grid">
                        <label class="is-switch">
                            <input type="checkbox" name="track_opens" value="1" <?php checked(!empty($settings['track_opens'])); ?>>
                            <span><b>Registrar aberturas</b><small>Pixel de 1x1 no rodapé do email.</small></span>
                        </label>
                        <label class="is-switch">
                            <input type="checkbox" name="track_clicks" value="1" <?php checked(!empty($settings['track_clicks'])); ?>>
                            <span><b>Registrar cliques</b><small>Links passam por um redirecionamento assinado.</small></span>
                        </label>
                        <label>
                            <span>Retenção de eventos (dias)</span>
                            <input type="number" min="30" max="3650" name="retention_days" value="<?php echo absint($settings['retention_days']); ?>">
                        </label>
                    </div>
                </section>

                <section id="kodety-settings-bounces">
                    <header>
                        <h2>Retornos e supressão</h2>
                        <p>Falhas síncronas são tratadas na fila. Para DSNs e reclamações posteriores, conecte seu MTA ou provedor ao webhook VERP autenticado.</p>
                    </header>
                    <div class="kodety-email-grid">
                        <label class="is-switch">
                            <input type="checkbox" name="bounce_enabled" value="1" <?php checked(!empty($settings['bounce_enabled'])); ?>>
                            <span>
                                <b>Gerar Return-Path VERP</b>
                                <small>Usa <code>bounce+token@dominio</code> para identificar o destinatário. Configure o recebimento e processe essa caixa externamente.</small>
                            </span>
                        </label>
                        <label class="is-wide">
                            <span>Segredo do webhook de retornos</span>
                            <input type="password" name="bounce_webhook_secret" minlength="24"
                                   autocomplete="new-password"
                                   placeholder="<?php echo !empty($settings['bounce_webhook_secret_configured']) ? 'Configurado — deixe vazio para manter' : 'Use ao menos 24 caracteres aleatórios'; ?>">
                            <small>Seu processador de DSN envia este valor em <code>X-Kodety-Bounce-Secret</code> ou <code>Authorization: Bearer</code>. O segredo salvo nunca volta à tela.</small>
                        </label>
                        <?php if (!empty($settings['bounce_webhook_secret_configured'])): ?>
                            <label class="kodety-preserved-setting kodety-preserved-setting--action is-wide">
                                <input type="checkbox" name="clear_bounce_webhook_secret" value="1">
                                <span>
                                    <strong>Revogar o segredo do webhook</strong>
                                    <small>Novos retornos serão recusados até você configurar outra credencial.</small>
                                </span>
                            </label>
                        <?php endif; ?>
                        <div class="kodety-webhook-setup is-wide">
                            <div>
                                <strong>Endpoint VERP</strong>
                                <code><?php echo esc_html(Kodety_Email_Bounces::endpoint_template()); ?></code>
                                <small>Substitua <code>{verp_token}</code> pelo token extraído do destinatário <code>bounce+token@dominio</code>. Envie <code>reason=bounce</code> ou <code>reason=complaint</code> e, opcionalmente, <code>diagnostic</code>.</small>
                            </div>
                            <button class="button" type="button"
                                    data-kodety-copy="<?php echo esc_attr(Kodety_Email_Bounces::endpoint_template()); ?>">Copiar endpoint</button>
                        </div>
                        <?php // Campos futuros ficam fora da edição, mas seus valores continuam salvos. ?>
                        <input type="hidden" name="bounce_protocol" value="<?php echo esc_attr($settings['bounce_protocol']); ?>">
                        <input type="hidden" name="bounce_host" value="<?php echo esc_attr($settings['bounce_host']); ?>">
                        <input type="hidden" name="bounce_port" value="<?php echo absint($settings['bounce_port']); ?>">
                        <input type="hidden" name="bounce_username" value="<?php echo esc_attr($settings['bounce_username']); ?>">
                        <input type="hidden" name="bounce_mailbox" value="<?php echo esc_attr($settings['bounce_mailbox']); ?>">

                        <div class="kodety-capability-status is-wide" aria-label="Recursos de retorno disponíveis">
                            <div class="is-available">
                                <span aria-hidden="true">✓</span>
                                <p><strong>Falha SMTP síncrona</strong><small>Caixas inválidas identificadas com segurança entram na supressão automaticamente.</small></p>
                                <b>Disponível</b>
                            </div>
                            <div class="is-available">
                                <span aria-hidden="true">✓</span>
                                <p><strong>Return-Path VERP</strong><small>O endereço codificado é gerado quando a opção acima está ativa.</small></p>
                                <b>Disponível</b>
                            </div>
                            <div class="is-available">
                                <span aria-hidden="true">✓</span>
                                <p><strong>Webhook de DSN</strong><small>Bounce e complaint assíncronos entram na supressão por um endpoint autenticado e idempotente.</small></p>
                                <b>Disponível</b>
                            </div>
                            <div class="is-future">
                                <span aria-hidden="true">–</span>
                                <p><strong>Leitor IMAP/POP3</strong><small>O Onun Kodety ainda não abre nem interpreta mensagens da caixa de retorno.</small></p>
                                <b>Indisponível</b>
                            </div>
                        </div>

                        <?php if ((string) $settings['bounce_host'] !== ''): ?>
                            <p class="kodety-preserved-setting is-wide">
                                Configuração de caixa preservada para uso futuro:
                                <strong><?php echo esc_html(strtoupper((string) $settings['bounce_protocol'])); ?></strong>
                                em <code><?php echo esc_html((string) $settings['bounce_host']); ?>:<?php echo absint($settings['bounce_port']); ?></code>.
                            </p>
                        <?php endif; ?>
                        <?php if (!empty($settings['bounce_password_configured'])): ?>
                            <label class="kodety-preserved-setting kodety-preserved-setting--action is-wide">
                                <input type="checkbox" name="clear_bounce_password" value="1">
                                <span>
                                    <strong>Remover a senha da caixa preservada</strong>
                                    <small>A credencial antiga será apagada ao salvar. Isso não altera o processamento de falhas SMTP.</small>
                                </span>
                            </label>
                        <?php endif; ?>
                    </div>
                </section>

                <div class="kodety-email-settings__save">
                    <button class="button button-primary button-hero">Salvar configurações</button>
                </div>
            </form>
        </div>
        <?php
    }

    // --- Partes compartilhadas -------------------------------------------

    public static function header(string $title, string $subtitle, string $current): void {
        $tabs = [
            'campaigns' => ['Campanhas', Kodety_Email_Marketing::PAGE_CAMPAIGNS, Kodety_Email_Schema::CAP_VIEW],
            'templates' => ['Templates', Kodety_Email_Marketing::PAGE_TEMPLATES, Kodety_Email_Schema::CAP_VIEW],
            'contacts' => ['Contatos', Kodety_Email_Marketing::PAGE_CONTACTS, Kodety_Email_Schema::CAP_VIEW],
            'lists' => ['Listas', Kodety_Email_Marketing::PAGE_LISTS, Kodety_Email_Schema::CAP_VIEW],
            'health' => ['Saúde de entrega', Kodety_Email_Marketing::PAGE_HEALTH, Kodety_Email_Schema::CAP_VIEW],
            'settings' => ['Config. de envio', Kodety_Email_Marketing::PAGE_SETTINGS, Kodety_Email_Schema::CAP_MANAGE],
        ];
        ?>
        <?php $current_label = isset($tabs[$current]) ? (string) $tabs[$current][0] : $title; ?>
        <header class="kodety-emails__header">
            <div class="kodety-email-header__copy">
                <p class="kodety-eyebrow">Onun Kodety Email Marketing</p>
                <h1><?php echo esc_html($title); ?></h1>
                <p><?php echo esc_html($subtitle); ?></p>
            </div>
            <div class="kodety-email-header__navigation">
                <span class="kodety-email-header__current"><?php echo esc_html($current_label); ?></span>
                <nav class="kodety-email-tabs" aria-label="Seções de Email Marketing">
                    <?php foreach ($tabs as $key => [$label, $page, $capability]): ?>
                        <?php if (!current_user_can($capability)) continue; ?>
                        <a class="kodety-email-tab <?php echo $current === $key ? 'is-current' : ''; ?>"
                           <?php echo $current === $key ? 'aria-current="page"' : ''; ?>
                           href="<?php echo esc_url(admin_url('admin.php?page=' . $page)); ?>"><?php echo esc_html($label); ?></a>
                    <?php endforeach; ?>
                </nav>
            </div>
        </header>
        <?php
    }

    public static function notices(): void {
        $message = isset($_GET['message']) ? sanitize_text_field(rawurldecode((string) wp_unslash($_GET['message']))) : '';
        $count = absint($_GET['count'] ?? 0);

        $done = isset($_GET['done']) ? sanitize_key((string) wp_unslash($_GET['done'])) : '';
        if ($done === 'list_created') self::notice('success', 'Lista criada.');
        if ($done === 'list_deleted') self::notice('success', 'Lista apagada. Os contatos permanecem na base.');
        if ($done === 'contact_added') self::notice('success', 'Contato adicionado.');
        if ($done === 'imported') self::notice('success', $message !== '' ? $message : 'Importação concluída.');
        if ($done === 'synced') self::notice('success', sprintf('%d contato(s) sincronizado(s).', $count));
        if ($done === 'bulk') self::notice('success', sprintf('%d contato(s) %s.', $count, $message));
        if ($done === 'template_deleted') self::notice('success', 'Template apagado.');
        if ($done === 'template_duplicated') self::notice('success', 'Template duplicado. A cópia está pronta para editar.');
        if ($done === 'duplicated') self::notice('success', 'Cópia criada como rascunho. Ajuste e dispare quando quiser.');
        if ($done === 'campaign_deleted') self::notice('success', 'Campanha apagada.');
        if ($done === 'campaign_saved') self::notice('success', 'Campanha salva.');
        if ($done === 'campaign_conflict') self::notice(
            'warning',
            'Outra aba salvou esta campanha primeiro. Recuperamos suas alterações abaixo sem sobrescrever a versão mais recente; revise e clique em salvar novamente.'
        );
        if ($done === 'schedule_cancelled') self::notice('success', 'A campanha antiga voltou a ser um rascunho e agora exige envio manual.');
        if ($done === 'campaign_queued') self::notice('success', sprintf('%d email(s) na fila. O envio começa agora.', $count));
        if ($done === 'campaign_ack_reconciled') self::notice(
            'success',
            'A entrega aceita pelo provedor foi registrada como incerta e terminal. Os demais destinatários voltaram a ser processados sem reenviar essa linha.'
        );
        if ($done === 'test_sent') self::notice('success', 'Email de teste enviado.');
        if ($done === 'error') self::notice('error', $message !== '' ? $message : 'Não foi possível concluir a ação.');

        if (isset($_GET['updated'])) self::notice('success', 'Configurações salvas.');
        if (isset($_GET['rechecked'])) self::notice('info', 'Verificação refeita com dados atuais do DNS.');

        $dkim = isset($_GET['dkim']) ? sanitize_key((string) wp_unslash($_GET['dkim'])) : '';
        if ($dkim === 'generated') self::notice('success', 'Par de chaves DKIM gerado. Publique o registro TXT abaixo para concluir.');
        if ($dkim === 'nodomain') self::notice('error', 'Configure um email de remetente válido antes de gerar as chaves.');
        if ($dkim === 'error') self::notice('error', 'Não foi possível gerar as chaves. ' . $message);

        $test = isset($_GET['test']) ? sanitize_key((string) wp_unslash($_GET['test'])) : '';
        if ($test === 'sent') self::notice('success', 'Email de teste enviado. Confira a caixa de destino e o cabeçalho da mensagem.');
        if ($test === 'invalid') self::notice('error', 'Informe um endereço de email válido para o teste.');
        if ($test === 'failed') self::notice('error', 'O envio de teste falhou. ' . $message);
    }

    private static function notice(string $type, string $message): void {
        printf(
            '<div class="notice notice-%s is-dismissible kodety-email-notice" role="%s" aria-live="%s"><p>%s</p></div>',
            esc_attr($type),
            $type === 'error' ? 'alert' : 'status',
            $type === 'error' ? 'assertive' : 'polite',
            esc_html($message)
        );
    }

    private static function dns_record(array $record): void {
        ?>
        <div class="kodety-dns-record">
            <div class="kodety-dns-record__row">
                <span>Tipo</span>
                <code><?php echo esc_html((string) $record['type']); ?></code>
            </div>
            <div class="kodety-dns-record__row">
                <span>Nome</span>
                <code><?php echo esc_html((string) $record['host']); ?></code>
            </div>
            <div class="kodety-dns-record__row is-value">
                <span>Valor</span>
                <code><?php echo esc_html((string) $record['value']); ?></code>
            </div>
            <button type="button" class="kodety-dns-record__copy"
                    data-kodety-copy="<?php echo esc_attr((string) $record['value']); ?>">Copiar valor</button>
        </div>
        <?php
    }

    /** @return array<int,array{id:string,label:string,description:string,warning:string}> */
    private static function transport_catalog(): array {
        return [
            [
                'id' => 'local',
                'label' => 'Servidor local',
                'description' => 'Usa o sendmail do próprio servidor. Funciona em qualquer hospedagem, sem configurar nada.',
                'warning' => '',
            ],
            [
                'id' => 'smtp',
                'label' => 'SMTP próprio',
                'description' => 'O servidor de email do seu domínio ou da sua hospedagem. Mais controle e melhor entrega que o modo local.',
                'warning' => '',
            ],
            [
                'id' => 'mx_direct',
                'label' => 'Entrega direta (MTA)',
                'description' => 'O WordPress conversa direto com o servidor do destinatário, sem intermediário nenhum.',
                'warning' => 'Avançado: exige porta 25 liberada na saída, IP dedicado e DNS reverso correto.',
            ],
        ];
    }

    private static function status_label(string $status): string {
        return match ($status) {
            Kodety_Email_Health::STATUS_OK => 'ok',
            Kodety_Email_Health::STATUS_WARN => 'atenção',
            default => 'pendente',
        };
    }

    private static function score_status(int $score): string {
        if ($score >= 85) return Kodety_Email_Health::STATUS_OK;
        if ($score >= 55) return Kodety_Email_Health::STATUS_WARN;
        return Kodety_Email_Health::STATUS_FAIL;
    }
}
