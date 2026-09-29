<?php
defined('ABSPATH') || exit;

// A standalone document: never call wp_head(), admin_head() or load the
// WordPress admin stylesheet. The PHP controller supplies translated copy.
?>
<!doctype html>
<html lang="<?php echo esc_attr($locale); ?>" class="kodety-onboarding-document" dir="<?php echo esc_attr($direction); ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <meta name="color-scheme" content="dark">
    <title><?php echo esc_html($t('Primeiros passos Onun Kodety')); ?></title>
    <link rel="preload" href="<?php echo esc_url(KODETY_URL . 'admin/fonts/inter-latin-variable.woff2'); ?>" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="<?php echo esc_url($asset_url('admin/onboarding.css')); ?>">
</head>
<body class="kodety-onboarding-page">
<div class="kodety-onboarding<?php echo $test_mode ? ' is-test-mode' : ''; ?>" data-kodety-onboarding data-config="<?php echo esc_attr(wp_json_encode($onboarding_config)); ?>">
    <aside class="kodety-onboarding__sidebar">
        <div class="kodety-onboarding__brand">
            <img src="<?php echo esc_url(KODETY_URL . 'admin/images/kodety-logo-full.svg'); ?>" width="124" height="26" alt="Onun Kodety">
            <span><?php echo esc_html($t('Seu próximo projeto começa aqui.')); ?></span>
        </div>
        <nav class="kodety-onboarding__navigation" aria-label="<?php echo esc_attr($t('Etapas da configuração')); ?>" data-kodety-navigation hidden>
            <ol>
                <?php foreach ($steps as $number => [$title, $description]): ?>
                <li>
                    <button type="button" class="kodety-onboarding__nav-step" data-kodety-step-go="<?php echo (int) $number; ?>" aria-controls="kodety-onboarding-step-<?php echo (int) $number; ?>" <?php disabled($number !== 1); ?> <?php if ($number === 1) echo 'aria-current="step"'; ?>>
                        <span class="kodety-onboarding__step-number" aria-hidden="true"><span><?php echo (int) $number; ?></span><?php echo $this->dashboard_icon('check'); ?></span>
                        <span class="kodety-onboarding__step-copy"><strong><?php echo esc_html($t($title)); ?></strong><small><?php echo esc_html($t($description)); ?></small></span>
                    </button>
                </li>
                <?php endforeach; ?>
            </ol>
        </nav>
        <div class="kodety-onboarding__sidebar-note">
            <?php echo $this->dashboard_icon('settings'); ?>
            <p><?php echo esc_html($t('Você pode ajustar estas preferências depois, nas configurações.')); ?></p>
        </div>
        <div class="kodety-onboarding__site" title="<?php echo esc_attr($studio_runtime ? $studio_runtime['displayPath'] : home_url()); ?>"><?php echo $this->dashboard_icon('website'); ?><span><?php echo esc_html($studio_runtime ? $studio_runtime['displayPath'] : (string) wp_parse_url(home_url(), PHP_URL_HOST)); ?></span></div>
    </aside>

    <main class="kodety-onboarding__main">
        <header class="kodety-onboarding__masthead">
            <span><?php echo esc_html($t($test_mode ? 'Prévia do onboarding' : 'Configuração inicial')); ?></span>
            <div class="kodety-onboarding__progress" data-kodety-progress-wrap hidden>
                <span data-kodety-step-counter aria-live="polite" aria-atomic="true"><?php echo esc_html(strtr($t($messages['counter']), ['{current}' => '1', '{total}' => '4'])); ?></span>
                <progress data-kodety-progress max="4" value="1" aria-label="<?php echo esc_attr($t('Progresso da configuração')); ?>"></progress>
            </div>
        </header>
        <?php if ($test_mode): ?>
        <div class="kodety-onboarding__preview-notice" role="note"><?php echo $this->dashboard_icon('eye'); ?><span><?php echo esc_html($t('Explore à vontade. Nenhuma alteração será salva nesta prévia.')); ?></span></div>
        <?php endif; ?>

        <form class="kodety-onboarding__form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data">
            <input type="hidden" name="action" value="kodety_complete_onboarding">
            <input type="hidden" name="kodety_workspace_mode" value="single">
            <?php if ($test_mode): ?><input type="hidden" name="kodety_onboarding_test" value="1"><?php endif; ?>
            <?php wp_nonce_field('kodety_complete_onboarding', 'kodety_onboarding_nonce'); ?>
            <?php if ($error !== ''): ?><div class="kodety-onboarding__error-summary" role="alert" tabindex="-1" data-kodety-server-error><?php echo $this->dashboard_icon('info'); ?><span><?php echo esc_html($t($error)); ?></span></div><?php endif; ?>
            <noscript><p class="kodety-onboarding__notice"><?php echo esc_html($t('JavaScript está desativado. Preencha as etapas abaixo para concluir.')); ?></p></noscript>

            <div class="kodety-onboarding__steps">
                <section class="kodety-onboarding__step" id="kodety-onboarding-step-1" data-kodety-step="1" aria-labelledby="kodety-onboarding-welcome">
                    <p class="kodety-onboarding__eyebrow"><?php echo esc_html($t('Bem-vindo ao Onun Kodety')); ?></p>
                    <h1 id="kodety-onboarding-welcome" tabindex="-1"><?php echo esc_html($t('Um espaço pronto para suas ideias.')); ?></h1>
                    <p class="kodety-onboarding__intro"><?php echo esc_html($t('Vamos preparar seu projeto, personalizar o painel e definir como você vai acessá-lo. São só quatro etapas.')); ?></p>
                    <?php if ($elementor_detected): ?>
                    <div
                        class="kodety-onboarding__notice kodety-onboarding__elementor-warning is-warning"
                        role="note"
                        data-kodety-elementor-warning
                        data-elementor-pages="<?php echo (int) $elementor_summary['pageCount']; ?>"
                        data-elementor-content="<?php echo (int) $elementor_summary['contentCount']; ?>"
                        data-elementor-templates="<?php echo (int) $elementor_summary['templateCount']; ?>"
                        <?php if (!empty($elementor_summary['frontPage'])) echo 'data-elementor-front-page="true"'; ?>
                        aria-labelledby="kodety-onboarding-elementor-warning"
                    >
                        <?php echo $this->dashboard_icon('info'); ?>
                        <div>
                            <strong id="kodety-onboarding-elementor-warning"><?php echo esc_html($t('Elementor detectado — publicar no Onun Kodety pode ocultar páginas e partes do site.')); ?></strong>
                            <?php if ((int) $elementor_summary['pageCount'] > 0): ?>
                            <p><?php echo esc_html(strtr(
                                $t((int) $elementor_summary['pageCount'] === 1
                                    ? 'Encontramos {count} página criada com Elementor{home}.'
                                    : 'Encontramos {count} páginas criadas com Elementor{home}.'),
                                [
                                    '{count}' => (string) (int) $elementor_summary['pageCount'],
                                    '{home}' => !empty($elementor_summary['frontPage']) ? $t(', incluindo a página inicial') : '',
                                ]
                            )); ?></p>
                            <?php endif; ?>
                            <?php if ((int) $elementor_summary['contentCount'] > 0): ?>
                            <p><?php echo esc_html(strtr(
                                $t((int) $elementor_summary['contentCount'] === 1
                                    ? 'Também encontramos {count} outro conteúdo criado com Elementor.'
                                    : 'Também encontramos {count} outros conteúdos criados com Elementor.'),
                                ['{count}' => (string) (int) $elementor_summary['contentCount']]
                            )); ?></p>
                            <?php endif; ?>
                            <?php if ((int) $elementor_summary['templateCount'] > 0): ?>
                            <p><?php echo esc_html(strtr(
                                $t((int) $elementor_summary['templateCount'] === 1
                                    ? 'O Theme Builder contém {count} modelo global do Elementor.'
                                    : 'O Theme Builder contém {count} modelos globais do Elementor.'),
                                ['{count}' => (string) (int) $elementor_summary['templateCount']]
                            )); ?></p>
                            <?php endif; ?>
                            <?php if ($elementor_pro_was_deactivated): ?>
                            <p><?php echo esc_html($t('Elementor Pro/Pro Elements foi desativado para evitar o conflito. O Elementor gratuito continua ativo para o Onun Kodety ler o HTML, CSS, JavaScript e widgets publicados. Nenhuma página, template, configuração ou mídia foi apagada.')); ?></p>
                            <?php else: ?>
                            <p><?php echo esc_html($t('Concluir este onboarding não altera nem apaga o Elementor. Porém, ao publicar, o Onun Kodety ativa o próprio tema e assume as rotas públicas. Conteúdos e partes do site podem deixar de aparecer, embora os dados continuem salvos no WordPress. Faça um backup ou converta antes de publicar.')); ?></p>
                            <?php endif; ?>
                            <button type="button" class="kodety-onboarding__elementor-action" data-kodety-elementor-inspect>
                                <span><?php echo esc_html($t('Examinar páginas do Elementor')); ?></span>
                                <?php echo $this->dashboard_icon('arrow-right'); ?>
                            </button>
                        </div>
                    </div>
                    <?php endif; ?>
                    <figure class="kodety-onboarding__showcase">
                        <img src="<?php echo esc_url(KODETY_URL . 'admin/images/login-showcase.webp'); ?>" width="1920" height="1472" alt="<?php echo esc_attr($t('Interface do Builder Onun Kodety com um projeto aberto')); ?>" fetchpriority="high">
                        <figcaption><?php echo $this->dashboard_icon('monitor'); ?><span><?php echo esc_html($t('Design, conteúdo e publicação no mesmo lugar.')); ?></span></figcaption>
                    </figure>
                    <div class="kodety-onboarding__overview">
                        <div><?php echo $this->dashboard_icon('pages'); ?><span><strong><?php echo esc_html($t('Seu projeto')); ?></strong><small><?php echo esc_html($t('Do zero ou do seu código')); ?></small></span></div>
                        <div><?php echo $this->dashboard_icon('palette'); ?><span><strong><?php echo esc_html($t('Sua identidade')); ?></strong><small><?php echo esc_html($t('Cor e logo no painel')); ?></small></span></div>
                        <div><?php echo $this->dashboard_icon('lock'); ?><span><strong><?php echo esc_html($t('Seu acesso')); ?></strong><small><?php echo esc_html($t('Um link de login próprio')); ?></small></span></div>
                    </div>
                </section>

                <section class="kodety-onboarding__step" id="kodety-onboarding-step-2" data-kodety-step="2" aria-labelledby="kodety-onboarding-project">
                    <p class="kodety-onboarding__eyebrow"><?php echo esc_html($t('Seu ponto de partida')); ?></p>
                    <h1 id="kodety-onboarding-project" tabindex="-1"><?php echo esc_html($t('Como você quer começar?')); ?></h1>
                    <p class="kodety-onboarding__intro"><?php echo esc_html($t($has_existing_project ? 'Encontramos um projeto neste WordPress. Continue de onde parou ou escolha um novo ponto de partida.' : 'Comece com um canvas em branco ou traga um projeto que você já criou.')); ?></p>
                    <fieldset aria-labelledby="kodety-onboarding-project" class="kodety-onboarding__choices is-project-choice<?php echo $has_existing_project ? ' has-existing' : ''; ?><?php echo $elementor_detected ? ' has-elementor' : ''; ?>">
                        <legend class="kodety-onboarding__sr-only"><?php echo esc_html($t('Origem do projeto')); ?></legend>
                        <?php if ($has_existing_project): ?>
                        <label>
                            <input type="radio" name="kodety_project_source" value="existing" <?php checked($source, 'existing'); ?>>
                            <span class="kodety-onboarding__choice">
                                <?php echo $this->dashboard_icon('monitor'); ?>
                                <span class="kodety-onboarding__choice-check"><?php echo $this->dashboard_icon('check'); ?></span>
                                <span class="kodety-onboarding__choice-copy">
                                    <strong><?php echo esc_html($t('Continuar projeto atual')); ?></strong>
                                    <small><?php echo esc_html($t('Preserva o Builder, o CMS e suas configurações.')); ?></small>
                                    <span class="kodety-onboarding__badge"><?php echo esc_html($t('Recomendado')); ?></span>
                                </span>
                            </span>
                        </label>
                        <?php endif; ?>
                        <?php if ($elementor_detected): ?>
                        <label>
                            <input type="radio" name="kodety_project_source" value="elementor" <?php checked($source, 'elementor'); ?>>
                            <span class="kodety-onboarding__choice">
                                <?php echo $this->dashboard_icon('pages'); ?>
                                <span class="kodety-onboarding__choice-check"><?php echo $this->dashboard_icon('check'); ?></span>
                                <span class="kodety-onboarding__choice-copy">
                                    <strong><?php echo esc_html($t('Converter do Elementor')); ?></strong>
                                    <small><?php echo esc_html($t('Transforma uma página detectada em um rascunho editável no Onun Kodety.')); ?></small>
                                    <span class="kodety-onboarding__badge"><?php echo esc_html($t('Recomendado')); ?></span>
                                </span>
                            </span>
                        </label>
                        <?php endif; ?>
                        <label>
                            <input type="radio" name="kodety_project_source" value="blank" <?php checked($source, 'blank'); ?>>
                            <span class="kodety-onboarding__choice">
                                <?php echo $this->dashboard_icon('pages'); ?>
                                <span class="kodety-onboarding__choice-check"><?php echo $this->dashboard_icon('check'); ?></span>
                                <span class="kodety-onboarding__choice-copy">
                                    <strong><?php echo esc_html($t('Criar do zero')); ?></strong>
                                    <small><?php echo esc_html($t('Um canvas em branco, pronto para suas ideias.')); ?></small>
                                </span>
                            </span>
                        </label>
                        <label>
                            <input type="radio" name="kodety_project_source" value="import" <?php checked($source, 'import'); ?>>
                            <span class="kodety-onboarding__choice">
                                <?php echo $this->dashboard_icon('upload'); ?>
                                <span class="kodety-onboarding__choice-check"><?php echo $this->dashboard_icon('check'); ?></span>
                                <span class="kodety-onboarding__choice-copy">
                                    <strong><?php echo esc_html($t('Importar projeto')); ?></strong>
                                    <small><?php echo esc_html($t('Um ZIP de HTML, Vite ou exportado pelo Onun Kodety.')); ?></small>
                                </span>
                            </span>
                        </label>
                    </fieldset>
                    <?php if ($elementor_detected): ?>
                    <section class="kodety-onboarding__elementor-pages" data-kodety-elementor-pages aria-labelledby="kodety-onboarding-elementor-pages-title">
                        <div class="kodety-onboarding__elementor-pages-heading">
                            <div>
                                <h2 id="kodety-onboarding-elementor-pages-title"><?php echo esc_html($t('Páginas encontradas no Elementor')); ?></h2>
                                <p><?php echo esc_html($t('Escolha a página que será transformada em um projeto Onun Kodety. Nada será convertido antes da sua confirmação.')); ?></p>
                            </div>
                            <span><?php echo esc_html(sprintf($t('%d página(s)'), count($elementor_pages))); ?></span>
                        </div>
                        <?php if ($elementor_pages): ?>
                        <div class="kodety-onboarding__elementor-page-list" role="radiogroup" aria-describedby="kodety-onboarding-elementor-page-error">
                            <?php foreach ($elementor_pages as $elementor_page):
                                $snapshot_ready = !empty($elementor_page['snapshotAvailable']);
                                $post_id = (int) $elementor_page['postId'];
                            ?>
                            <label class="kodety-onboarding__elementor-page">
                                <input
                                    type="radio"
                                    name="kodety_elementor_post_id"
                                    value="<?php echo $post_id; ?>"
                                    data-kodety-elementor-page
                                    data-snapshot-ready="<?php echo $snapshot_ready ? 'true' : 'false'; ?>"
                                    <?php checked($selected_elementor_post_id, $post_id); ?>
                                >
                                <span class="kodety-onboarding__elementor-page-check"><?php echo $this->dashboard_icon('check'); ?></span>
                                <span class="kodety-onboarding__elementor-page-copy">
                                    <strong><?php echo esc_html((string) $elementor_page['title']); ?></strong>
                                    <small>
                                        <span>#<?php echo $post_id; ?></span>
                                        <span><?php echo esc_html($t((string) $elementor_page['statusLabel'])); ?></span>
                                        <?php if ((string) $elementor_page['url'] !== ''): ?><span title="<?php echo esc_attr((string) $elementor_page['url']); ?>"><?php echo esc_html((string) wp_parse_url((string) $elementor_page['url'], PHP_URL_PATH) ?: '/'); ?></span><?php endif; ?>
                                    </small>
                                </span>
                                <span class="kodety-onboarding__elementor-page-state <?php echo $snapshot_ready ? 'is-ready' : 'is-missing'; ?>">
                                    <?php echo esc_html($t($snapshot_ready ? 'HTML, CSS e JS prontos' : 'Será capturada ao converter')); ?>
                                </span>
                            </label>
                            <?php endforeach; ?>
                        </div>
                        <?php else: ?>
                        <div class="kodety-onboarding__notice is-warning"><?php echo $this->dashboard_icon('info'); ?><p><?php echo esc_html($t('Nenhuma página Elementor importável foi encontrada.')); ?></p></div>
                        <?php endif; ?>
                        <p class="kodety-onboarding__field-error" aria-live="polite" id="kodety-onboarding-elementor-page-error" data-kodety-elementor-page-error hidden></p>
                        <button type="submit" name="kodety_elementor_convert_now" value="1" formnovalidate class="kodety-onboarding__elementor-confirm" data-kodety-elementor-confirm>
                            <span><?php echo esc_html($t('Converter página selecionada')); ?></span>
                            <?php echo $this->dashboard_icon('arrow-right'); ?>
                        </button>
                    </section>
                    <?php endif; ?>
                    <div class="kodety-onboarding__field" data-kodety-project-name-field>
                        <label for="kodety-onboarding-project-name"><?php echo esc_html($t('Nome do projeto')); ?></label>
                        <div class="kodety-onboarding__control">
                            <span class="kodety-onboarding__glyph"><?php echo $this->dashboard_icon('text'); ?></span>
                            <input id="kodety-onboarding-project-name" name="kodety_project_name" type="text" value="<?php echo esc_attr($current_project_name); ?>" maxlength="120" required autocomplete="off" data-kodety-project-name aria-describedby="kodety-onboarding-project-error">
                        </div>
                        <p class="kodety-onboarding__field-error" aria-live="polite" id="kodety-onboarding-project-error" data-kodety-project-error hidden></p>
                    </div>
                    <label class="kodety-onboarding__upload" data-kodety-onboarding-upload>
                        <input name="kodety_project_zip" type="file" accept=".zip,application/zip" aria-describedby="kodety-onboarding-zip-error">
                        <span class="kodety-onboarding__upload-icon"><?php echo $this->dashboard_icon('upload'); ?></span>
                        <span class="kodety-onboarding__upload-copy"><strong><?php echo esc_html($t('Escolher arquivo ZIP')); ?></strong><small data-kodety-onboarding-filename><?php echo esc_html($t('Nenhum arquivo selecionado')); ?></small></span>
                        <span class="kodety-onboarding__upload-action"><?php echo esc_html($t('Selecionar')); ?></span>
                    </label>
                    <p class="kodety-onboarding__field-error" aria-live="polite" id="kodety-onboarding-zip-error" data-kodety-zip-error hidden></p>
                    <?php if ($has_existing_project): ?><div class="kodety-onboarding__notice is-warning" data-kodety-replace-warning hidden><?php echo $this->dashboard_icon('info'); ?><p><?php echo esc_html($t('Ao concluir, o projeto aberto será substituído. Exporte uma cópia antes de continuar se quiser guardá-lo.')); ?></p></div><?php endif; ?>
                </section>

                <section class="kodety-onboarding__step" id="kodety-onboarding-step-3" data-kodety-step="3" aria-labelledby="kodety-onboarding-identity">
                    <p class="kodety-onboarding__eyebrow"><?php echo esc_html($t('Os detalhes fazem diferença')); ?></p>
                    <h1 id="kodety-onboarding-identity" tabindex="-1"><?php echo esc_html($t('Um painel com a sua identidade.')); ?></h1>
                    <p class="kodety-onboarding__intro"><?php echo esc_html($t('Escolha uma cor e, se quiser, adicione sua logo ao painel WordPress. O Builder e as áreas do produto mantêm a marca Onun Kodety.')); ?></p>
                    <div class="kodety-onboarding__identity">
                        <div class="kodety-onboarding__field">
                            <label for="kodety-onboarding-color"><?php echo esc_html($t('Cor de destaque')); ?></label>
                            <div class="kodety-onboarding__control kodety-onboarding__color-control" style="--kodety-onboarding-color: <?php echo esc_attr($accent); ?>">
                                <span class="kodety-onboarding__swatch" aria-hidden="true"></span>
                                <output for="kodety-onboarding-color"><?php echo esc_html(strtoupper($accent)); ?></output>
                                <span class="kodety-onboarding__color-hint"><?php echo esc_html($t('Alterar')); ?></span>
                                <input id="kodety-onboarding-color" name="kodety_admin_accent_color" type="color" value="<?php echo esc_attr($accent); ?>" aria-describedby="kodety-onboarding-color-hint">
                            </div>
                            <small class="kodety-onboarding__hint" id="kodety-onboarding-color-hint"><?php echo esc_html($t('Cores sem contraste suficiente usam o violeta padrão.')); ?></small>
                        </div>
                        <div class="kodety-onboarding__field">
                            <label for="kodety-onboarding-logo"><?php echo esc_html($t('Logo do painel')); ?><span class="kodety-onboarding__optional"><?php echo esc_html($t('Opcional')); ?></span></label>
                            <label class="kodety-onboarding__upload is-logo">
                                <input id="kodety-onboarding-logo" name="kodety_admin_logo" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="kodety-onboarding-logo-error">
                                <span class="kodety-onboarding__upload-icon"><?php echo $this->dashboard_icon('image'); ?></span>
                                <span class="kodety-onboarding__upload-copy"><strong data-kodety-logo-name><?php echo esc_html($t('Escolher imagem')); ?></strong><small><?php echo esc_html($t('PNG, JPG ou WebP · opcional')); ?></small></span>
                                <span class="kodety-onboarding__upload-action"><?php echo $this->dashboard_icon('upload'); ?></span>
                            </label>
                            <p class="kodety-onboarding__field-error" aria-live="polite" id="kodety-onboarding-logo-error" data-kodety-logo-error hidden></p>
                        </div>
                    </div>
                    <figure class="kodety-onboarding__brand-preview" data-kodety-brand-preview style="--kodety-onboarding-color: <?php echo esc_attr($accent); ?>">
                        <figcaption><?php echo $this->dashboard_icon('monitor'); ?><span><?php echo esc_html($t('Prévia do painel WordPress')); ?></span><span class="kodety-onboarding__badge"><?php echo esc_html($t('Sua marca')); ?></span></figcaption>
                        <div class="kodety-onboarding__mini-panel" aria-hidden="true">
                            <div class="kodety-onboarding__mini-sidebar">
                                <div class="kodety-onboarding__mini-brand"><img data-kodety-logo-preview src="<?php echo esc_url($logo_url ?: KODETY_URL . 'admin/images/kodety-logo-full.svg'); ?>" alt="" width="96" height="24"></div>
                                <span class="is-selected"><?php echo $this->dashboard_icon('pages'); ?><?php echo esc_html($t('Páginas')); ?></span>
                                <span><?php echo $this->dashboard_icon('media'); ?><?php echo esc_html($t('Mídia')); ?></span>
                                <span><?php echo $this->dashboard_icon('settings'); ?><?php echo esc_html($t('Configurações')); ?></span>
                            </div>
                            <div class="kodety-onboarding__mini-content"><span class="kodety-onboarding__mini-label"><?php echo esc_html($t('Seu projeto')); ?></span><strong data-kodety-name-preview><?php echo esc_html($current_project_name); ?></strong><div class="kodety-onboarding__mini-page"><?php echo $this->dashboard_icon('file'); ?><span><?php echo esc_html($t('Página inicial')); ?><small><?php echo esc_html($t('Pronta para editar')); ?></small></span><?php echo $this->dashboard_icon('chevron-right'); ?></div><span class="kodety-onboarding__mini-button"><?php echo $this->dashboard_icon('plus'); ?><?php echo esc_html($t('Nova página')); ?></span></div>
                        </div>
                    </figure>
                </section>

                <section class="kodety-onboarding__step" id="kodety-onboarding-step-4" data-kodety-step="4" aria-labelledby="kodety-onboarding-login">
                    <?php if ($studio_runtime): ?>
                    <p class="kodety-onboarding__eyebrow"><?php echo esc_html($t('Projeto local')); ?></p>
                    <h1 id="kodety-onboarding-login" tabindex="-1"><?php echo esc_html($t('Seu projeto continua neste navegador.')); ?></h1>
                    <p class="kodety-onboarding__intro"><?php echo esc_html($t('No Onun Kodety, você volta ao WordPress pela biblioteca de projetos. Não é preciso guardar o endereço técnico do Playground.')); ?></p>
                    <div class="kodety-onboarding__login-info"><?php echo $this->dashboard_icon('shield'); ?><p><?php echo esc_html($t('Este é o endereço amigável da sua prévia local:')); ?> <code><?php echo esc_html($studio_runtime['displayPath']); ?></code></p></div>
                    <div class="kodety-onboarding__studio-preview">
                        <div class="kodety-onboarding__studio-preview-heading">
                            <span><?php echo esc_html($t('Prévia local do site')); ?></span>
                            <p><?php echo esc_html($t('Este atalho volta ao Studio e abre a versão publicada somente no seu navegador.')); ?></p>
                        </div>
                        <a class="kodety-onboarding__studio-site-action" href="<?php echo esc_url($studio_runtime['previewUrl']); ?>" target="_blank" rel="noopener noreferrer">
                            <span class="kodety-onboarding__studio-site-icon"><?php echo $this->dashboard_icon('website'); ?></span>
                            <span class="kodety-onboarding__studio-site-copy"><strong><?php echo esc_html($t('Abrir na aba Site')); ?></strong><small><?php echo esc_html($studio_runtime['displayPath']); ?></small></span>
                            <span class="kodety-onboarding__studio-site-arrow"><?php echo $this->dashboard_icon('arrow-right'); ?></span>
                        </a>
                    </div>
                    <div hidden aria-hidden="true">
                        <input name="kodety_admin_slug" type="hidden" value="<?php echo esc_attr($login_slug); ?>" data-kodety-login-slug>
                        <input type="text" value="" data-kodety-login-url tabindex="-1">
                        <button type="button" data-kodety-copy-login tabindex="-1"></button>
                        <span data-kodety-copy-status></span>
                        <input type="checkbox" name="kodety_login_saved" value="1" checked data-kodety-login-saved tabindex="-1">
                        <span data-kodety-saved-error></span>
                        <span data-kodety-slug-error></span>
                    </div>
                    <p class="kodety-onboarding__security-note"><?php echo $this->dashboard_icon('info'); ?><span><?php echo esc_html($t('Transferir para hospedagem é o passo que gera o ZIP para levar este projeto ao WordPress final.')); ?></span></p>
                    <?php else: ?>
                    <p class="kodety-onboarding__eyebrow"><?php echo esc_html($t('Guarde este endereço')); ?></p>
                    <h1 id="kodety-onboarding-login" tabindex="-1"><?php echo esc_html($t('Seu próximo acesso começa aqui.')); ?></h1>
                    <p class="kodety-onboarding__intro"><?php echo esc_html($t($login_locked && $current_login_slug === '' ? 'Esta instalação usa o login padrão do WordPress. Guarde o link abaixo para voltar ao painel. Sua conta e sua senha continuam as mesmas.' : 'O Onun Kodety usa um link de login próprio para reduzir acessos automatizados ao formulário padrão. Sua conta e sua senha continuam as mesmas.')); ?></p>
                    <div class="kodety-onboarding__login-info"><?php echo $this->dashboard_icon('shield'); ?><p><?php echo esc_html($t('O endereço padrão do Onun Kodety é')); ?> <code>/<?php echo esc_html(Kodety_Security::DEFAULT_SLUG); ?></code>. <?php echo esc_html($t($login_locked ? 'Veja abaixo o endereço ativo nesta instalação.' : 'Você pode mantê-lo ou escolher outro abaixo.')); ?></p></div>
                    <?php if (!$login_locked): ?>
                    <div class="kodety-onboarding__field">
                        <label for="kodety-onboarding-login-slug"><?php echo esc_html($t('Endereço de login')); ?><span class="kodety-onboarding__badge" data-kodety-slug-status><?php echo esc_html($t($login_slug === Kodety_Security::DEFAULT_SLUG ? 'Padrão Onun Kodety' : 'Personalizado')); ?></span></label>
                        <div class="kodety-onboarding__control kodety-onboarding__slug-control" dir="ltr">
                            <span class="kodety-onboarding__glyph"><?php echo $this->dashboard_icon('link'); ?></span>
                            <span class="kodety-onboarding__url-prefix" title="<?php echo esc_attr($login_base); ?>"><?php echo esc_html($login_base); ?></span>
                            <input id="kodety-onboarding-login-slug" name="kodety_admin_slug" type="text" value="<?php echo esc_attr($login_slug); ?>" required autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="kodety-onboarding-slug-hint kodety-onboarding-slug-error" data-kodety-login-slug>
                            <button type="button" class="kodety-onboarding__inline-action" data-kodety-default-slug title="<?php echo esc_attr($t('Usar o endereço padrão do Onun Kodety')); ?>"><?php echo esc_html($t('Usar padrão')); ?></button>
                        </div>
                        <small class="kodety-onboarding__hint" id="kodety-onboarding-slug-hint"><?php echo esc_html($t('Use letras minúsculas, números e hífens. O novo link será aplicado ao concluir.')); ?></small>
                        <p class="kodety-onboarding__field-error" aria-live="polite" id="kodety-onboarding-slug-error" data-kodety-slug-error hidden></p>
                    </div>
                    <?php else: ?>
                    <div class="kodety-onboarding__notice"><?php echo $this->dashboard_icon('lock'); ?><p><?php echo esc_html($t(is_multisite() ? 'Esta instalação usa o login compartilhado da rede WordPress. O endereço é gerenciado pelo administrador da rede.' : 'O endereço de login é controlado pelo wp-config.php e não pode ser alterado aqui.')); ?></p></div>
                    <?php endif; ?>
                    <div class="kodety-onboarding__login-card">
                        <label for="kodety-onboarding-login-url"><?php echo esc_html($t('Seu link de acesso ao painel')); ?></label>
                        <div class="kodety-onboarding__control kodety-onboarding__copy-control" dir="ltr">
                            <span class="kodety-onboarding__glyph"><?php echo $this->dashboard_icon('lock'); ?></span>
                            <input id="kodety-onboarding-login-url" type="text" value="<?php echo esc_attr($login_url); ?>" readonly data-kodety-login-url aria-describedby="kodety-onboarding-copy-status" spellcheck="false">
                            <button type="button" class="kodety-onboarding__inline-action" data-kodety-copy-login><?php echo $this->dashboard_icon('copy'); ?><span><?php echo esc_html($t('Copiar link')); ?></span></button>
                        </div>
                        <p class="kodety-onboarding__copy-status" id="kodety-onboarding-copy-status" data-kodety-copy-status role="status" aria-live="polite"><?php echo esc_html($t($messages['copyHint'])); ?></p>
                        <label class="kodety-onboarding__acknowledge">
                            <input type="checkbox" name="kodety_login_saved" value="1" required data-kodety-login-saved aria-describedby="kodety-onboarding-saved-error">
                            <span class="kodety-onboarding__checkbox" aria-hidden="true"><?php echo $this->dashboard_icon('check'); ?></span>
                            <span><?php echo esc_html($t('Guardei este link para acessar meu painel.')); ?></span>
                        </label>
                        <p class="kodety-onboarding__field-error" aria-live="polite" id="kodety-onboarding-saved-error" data-kodety-saved-error hidden></p>
                    </div>
                    <p class="kodety-onboarding__security-note"><?php echo $this->dashboard_icon('info'); ?><span><?php echo esc_html($t($login_locked ? 'Guarde o link em um local seguro e use uma senha forte para a sua conta.' : 'Um endereço próprio não substitui uma senha forte. Você poderá alterá-lo depois na Central de segurança.')); ?></span></p>
                    <?php endif; ?>
                </section>
            </div>
            <footer class="kodety-onboarding__footer">
                <button type="button" class="kodety-onboarding__back" data-kodety-back hidden><?php echo $this->dashboard_icon('arrow-left'); ?><span><?php echo esc_html($t('Voltar')); ?></span></button>
                <p><?php echo esc_html($t($test_mode ? 'Nenhuma alteração será salva.' : 'Tudo será aplicado ao concluir.')); ?></p>
                <button type="button" class="kodety-onboarding__primary" data-kodety-next hidden><span data-kodety-next-label><?php echo esc_html($t('Vamos começar')); ?></span><?php echo $this->dashboard_icon('arrow-right'); ?></button>
                <button type="submit" class="kodety-onboarding__primary" data-kodety-finish><span data-kodety-finish-label><?php echo esc_html($t($test_mode ? 'Encerrar prévia' : 'Concluir configuração')); ?></span><?php echo $this->dashboard_icon('check'); ?></button>
            </footer>
        </form>
        <p class="kodety-onboarding__sr-only" role="status" aria-live="polite" aria-atomic="true" data-kodety-submit-status></p>
    </main>
</div>
<script src="<?php echo esc_url($asset_url('admin/components/kodety-icons.bundle.js')); ?>" defer></script>
<script src="<?php echo esc_url($asset_url('admin/onboarding.js')); ?>" defer></script>
</body>
</html>
