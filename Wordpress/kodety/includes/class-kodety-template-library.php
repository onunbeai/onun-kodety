<?php

defined('ABSPATH') || exit;

/**
 * Reusable project templates for every kind of Onun Kodety site.
 *
 * Bundled templates live in KODETY_DIR/template-library/<slug>/ with a
 * template.json plus either project/ or project.zip. User uploads are kept in
 * private persistent storage so plugin updates never remove them.
 */
final class Kodety_Template_Library {
    private const SCHEMA_VERSION = 1;
    private const MAX_FILES = 10000;
    private const MAX_FILE_BYTES = 256 * MB_IN_BYTES;
    private const MAX_TOTAL_BYTES = 768 * MB_IN_BYTES;
    private const MANIFEST = 'template.json';
    private static ?self $instance = null;
    private string $user_directory;
    private string $hook_suffix = '';

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        $uploads = wp_upload_dir();
        $base = is_array($uploads) ? (string) ($uploads['basedir'] ?? '') : '';
        if ($base === '') $base = WP_CONTENT_DIR . '/uploads';
        $this->user_directory = trailingslashit($base) . 'kodety/private/templates';
        add_action('admin_menu', [$this, 'admin_menu'], 101);
        add_action('admin_enqueue_scripts', [$this, 'admin_assets']);
        add_action('admin_post_kodety_upload_template', [$this, 'upload_template']);
        add_action('admin_post_kodety_apply_template', [$this, 'apply_template']);
        add_action('rest_api_init', [$this, 'rest_routes']);
    }

    public function admin_menu(): void {
        $i18n = class_exists('Kodety_Admin_I18n') ? Kodety_Admin_I18n::instance() : null;
        $this->hook_suffix = (string) add_submenu_page(
            'kodety',
            $i18n ? $i18n->translate('Templates Onun Kodety') : 'Templates Onun Kodety',
            $i18n ? $i18n->translate('Templates') : 'Templates',
            Kodety_Plugin::CAP_EDIT_WORKSPACE,
            'kodety-templates',
            [$this, 'render_page']
        );
    }

    public function admin_assets(string $hook): void {
        if ($hook !== $this->hook_suffix) return;
        wp_enqueue_style(
            'kodety-template-library',
            KODETY_URL . 'admin/templates.css',
            [],
            KODETY_VERSION
        );
    }

    public function rest_routes(): void {
        $permission = static fn(): bool => current_user_can('kodety_import')
            && current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE);
        register_rest_route('kodety/v1', '/templates', [
            'methods' => WP_REST_Server::READABLE,
            'permission_callback' => $permission,
            'callback' => [$this, 'rest_catalog'],
        ]);
        register_rest_route('kodety/v1', '/templates/apply', [
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => $permission,
            'callback' => [$this, 'rest_apply'],
        ]);
        register_rest_route('kodety/v1', '/templates/upload', [
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => $permission,
            'callback' => [$this, 'rest_upload'],
        ]);
    }

    public function rest_catalog(): WP_REST_Response {
        $items = array_map(static function (array $template): array {
            unset($template['sourcePath']);
            return $template;
        }, $this->templates());
        return new WP_REST_Response([
            'templates' => array_values($items),
            'hasWorkspace' => Kodety_Plugin::instance()->has_editable_workspace(),
            'categories' => [
                'ecommerce' => 'Ecommerce',
                'landing-page' => 'Landing pages',
                'business' => 'Negócios',
                'portfolio' => 'Portfólio',
                'blog' => 'Blog',
                'other' => 'Outros',
            ],
        ]);
    }

    public function rest_apply(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $slug = sanitize_key((string) $request->get_param('template'));
        $template = null;
        foreach ($this->templates() as $candidate) {
            if (hash_equals((string) $candidate['slug'], $slug)) {
                $template = $candidate;
                break;
            }
        }
        if (!is_array($template)) {
            return new WP_Error('kodety_template_missing', 'O template escolhido não está mais disponível.', ['status' => 404]);
        }
        $plugin = Kodety_Plugin::instance();
        if ($plugin->has_editable_workspace()) {
            $acknowledged = rest_sanitize_boolean($request->get_param('replaceAcknowledged'));
            $phrase = trim((string) $request->get_param('replacePhrase'));
            if (!$acknowledged || !hash_equals('APLICAR', $phrase)) {
                return new WP_Error(
                    'kodety_template_confirmation',
                    'Marque a confirmação e digite APLICAR para substituir o rascunho atual.',
                    ['status' => 409]
                );
            }
        }
        try {
            $plugin->install_template_source(
                (string) $template['sourcePath'],
                sanitize_file_name((string) $template['slug']) . '-template.zip',
                (string) $template['name'],
                $request
            );
            return new WP_REST_Response([
                'success' => true,
                'builderUrl' => add_query_arg('kodety_template', rawurlencode($slug), home_url('/kodety/editor/')),
            ]);
        } catch (Throwable $error) {
            $conflict = $error instanceof DomainException && $error->getCode() === 409;
            return new WP_Error($conflict ? 'kodety_workspace_conflict' : 'kodety_template_apply_failed', $error->getMessage(), ['status' => $conflict ? 409 : 500]);
        }
    }

    public function rest_upload(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $files = $request->get_file_params();
        $file = is_array($files['template_zip'] ?? null) ? $files['template_zip'] : null;
        if (!$file || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            return new WP_Error('kodety_template_upload_missing', 'Selecione um arquivo ZIP válido.', ['status' => 400]);
        }
        try {
            $template = $this->store_uploaded_template($file, [
                'name' => (string) $request->get_param('template_name'),
                'category' => (string) $request->get_param('template_category'),
                'description' => (string) $request->get_param('template_description'),
            ]);
            return new WP_REST_Response(['success' => true, 'template' => $template], 201);
        } catch (Throwable $error) {
            return new WP_Error('kodety_template_upload_failed', $error->getMessage(), ['status' => 400]);
        }
    }

    /** @return list<array<string,mixed>> */
    public function templates(): array {
        $sources = array_merge(
            $this->scan_catalog(KODETY_DIR . 'template-library', 'bundled'),
            $this->scan_catalog($this->user_directory, 'uploaded')
        );
        /**
         * Extensions can register a project directory/ZIP without copying it
         * into the core plugin. Each item accepts sourcePath and catalog data.
         *
         * @param list<array<string,mixed>> $sources
         */
        $sources = apply_filters('kodety_template_library_sources', $sources);
        if (!is_array($sources)) $sources = [];
        $templates = [];
        foreach ($sources as $source) {
            if (!is_array($source)) continue;
            $template = $this->normalize_template($source);
            if ($template === null || isset($templates[$template['slug']])) continue;
            $templates[$template['slug']] = $template;
        }
        uasort($templates, static function (array $left, array $right): int {
            $featured = (int) !empty($right['featured']) <=> (int) !empty($left['featured']);
            return $featured !== 0 ? $featured : strcasecmp((string) $left['name'], (string) $right['name']);
        });
        return array_values($templates);
    }

    public function render_page(): void {
        if (!current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE)) return;
        $templates = $this->templates();
        $has_workspace = Kodety_Plugin::instance()->has_editable_workspace();
        $notice = isset($_GET['kodety_template_notice'])
            ? sanitize_key((string) wp_unslash($_GET['kodety_template_notice']))
            : '';
        $categories = [
            'all' => 'Todos',
            'ecommerce' => 'Ecommerce',
            'landing-page' => 'Landing pages',
            'business' => 'Negócios',
            'portfolio' => 'Portfólio',
            'blog' => 'Blog',
            'other' => 'Outros',
        ];
        $selected_category = sanitize_key((string) wp_unslash($_GET['category'] ?? 'all'));
        if (!isset($categories[$selected_category])) $selected_category = 'all';
        ?>
        <div class="wrap kodety-template-library">
            <header class="kodety-template-hero">
                <div>
                    <span class="kodety-template-eyebrow">BIBLIOTECA KODETY</span>
                    <h1>Modelos</h1>
                    <p>Comece com um site completo e personalize páginas, estilos e componentes no Builder.</p>
                </div>
                <a class="button button-primary" href="#kodety-add-template">Adicionar template</a>
            </header>

            <?php if ($notice === 'uploaded'): ?>
                <div class="notice kodety-notice notice-success is-dismissible"><p>Template adicionado à biblioteca.</p></div>
            <?php elseif ($notice === 'error'): ?>
                <div class="notice kodety-notice notice-error is-dismissible"><p><?php echo esc_html((string) get_transient('kodety_template_error_' . get_current_user_id())); ?></p></div>
                <?php delete_transient('kodety_template_error_' . get_current_user_id()); ?>
            <?php endif; ?>

            <nav class="kodety-template-filters" aria-label="Categorias de templates">
                <?php foreach ($categories as $slug => $label): ?>
                    <a class="<?php echo $selected_category === $slug ? 'is-active' : ''; ?>" href="<?php echo esc_url(add_query_arg(['page' => 'kodety-templates', 'category' => $slug], admin_url('admin.php'))); ?>" <?php if ($selected_category === $slug): ?>aria-current="page"<?php endif; ?>><?php echo esc_html($label); ?></a>
                <?php endforeach; ?>
            </nav>

            <main id="templates" class="kodety-template-grid">
                <?php if (!$templates): ?>
                    <section class="kodety-template-empty"><h2>Nenhum template disponível ainda.</h2><p>Envie um ZIP abaixo ou adicione uma pasta ao catálogo do plugin.</p></section>
                <?php endif; ?>
                <?php foreach ($templates as $template):
                    $category = sanitize_key((string) $template['category']);
                    if ($selected_category !== 'all' && $selected_category !== $category) continue;
                    $accent = $this->accent_for_slug((string) $template['slug']);
                    ?>
                    <article id="template-<?php echo esc_attr((string) $template['slug']); ?>" class="kodety-template-card" data-template-category="<?php echo esc_attr($category); ?>" style="--template-accent: <?php echo esc_attr($accent); ?>">
                        <div class="kodety-template-card__preview" aria-hidden="true">
                            <span><?php echo esc_html((string) $template['badge']); ?></span>
                            <strong><?php echo esc_html((string) $template['name']); ?></strong>
                            <i></i><i></i><i></i>
                        </div>
                        <div class="kodety-template-card__body">
                            <div class="kodety-template-card__meta">
                                <span><?php echo esc_html($categories[$category] ?? 'Outros'); ?></span>
                                <?php if (!empty($template['featured'])): ?><em>Destaque</em><?php endif; ?>
                            </div>
                            <h2><?php echo esc_html((string) $template['name']); ?></h2>
                            <p><?php echo esc_html((string) $template['description']); ?></p>
                            <ul>
                                <li><?php echo esc_html(Kodety_Admin_I18n::instance()->format_number($template['pages']) . ((int) $template['pages'] === 1 ? ' página' : ' páginas')); ?></li>
                                <li><?php echo esc_html((string) $template['sourceLabel']); ?></li>
                                <li>100% editável</li>
                            </ul>
                            <details class="kodety-template-apply">
                                <summary>Usar este template</summary>
                                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                                    <input type="hidden" name="action" value="kodety_apply_template">
                                    <input type="hidden" name="template" value="<?php echo esc_attr((string) $template['slug']); ?>">
                                    <?php wp_nonce_field('kodety_apply_template_' . $template['slug']); ?>
                                    <?php if ($has_workspace): ?>
                                        <p><strong>O workspace atual será substituído.</strong> O site publicado só muda quando você publicar pelo Builder.</p>
                                        <label><input type="checkbox" name="replace_acknowledged" value="1" required> Entendo que o rascunho atual será trocado.</label>
                                        <label>Digite <code>APLICAR</code><input type="text" name="replace_phrase" pattern="APLICAR" autocomplete="off" required></label>
                                    <?php else: ?>
                                        <p>O template será aberto como um novo rascunho no Builder.</p>
                                    <?php endif; ?>
                                    <button class="button button-primary" type="submit">Abrir no Builder</button>
                                </form>
                            </details>
                        </div>
                    </article>
                <?php endforeach; ?>
            </main>

            <section id="kodety-add-template" class="kodety-template-upload">
                <div>
                    <span class="kodety-template-eyebrow">SEU CATÁLOGO</span>
                    <h2>Adicionar um template completo</h2>
                    <p>Envie um ZIP Onun Kodety/HTML autocontido. Ele fica salvo de forma privada e aparece nesta biblioteca para reutilização.</p>
                    <p class="description">Para distribuir com o plugin, use <code>template-library/&lt;slug&gt;/template.json</code> junto de <code>project/</code> ou <code>project.zip</code>.</p>
                </div>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data">
                    <input type="hidden" name="action" value="kodety_upload_template">
                    <?php wp_nonce_field('kodety_upload_template'); ?>
                    <label><span>Nome</span><input type="text" name="template_name" maxlength="120" placeholder="Ex.: Studio Portfolio"></label>
                    <label><span>Categoria</span><select name="template_category"><?php foreach (array_slice($categories, 1, null, true) as $slug => $label): ?><option value="<?php echo esc_attr($slug); ?>"><?php echo esc_html($label); ?></option><?php endforeach; ?></select></label>
                    <label class="is-wide"><span>Descrição</span><textarea name="template_description" maxlength="360" rows="3" placeholder="Explique para qual tipo de site este template foi criado."></textarea></label>
                    <label class="kodety-template-upload__file is-wide"><input type="file" name="template_zip" accept=".zip,application/zip" required><span>Selecionar template ZIP</span><small>Raiz plana, com pelo menos um arquivo HTML.</small></label>
                    <button class="button button-primary" type="submit">Adicionar à biblioteca</button>
                </form>
            </section>
        </div>
        <?php
    }

    public function apply_template(): void {
        if (!current_user_can('kodety_import') || !current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE)) {
            wp_die('Sem permissão para aplicar templates.', '', ['response' => 403]);
        }
        $slug = sanitize_key((string) wp_unslash($_POST['template'] ?? ''));
        check_admin_referer('kodety_apply_template_' . $slug);
        $template = null;
        foreach ($this->templates() as $candidate) {
            if (hash_equals((string) $candidate['slug'], $slug)) {
                $template = $candidate;
                break;
            }
        }
        if (!is_array($template)) $this->redirect_error('O template escolhido não está mais disponível.');
        $plugin = Kodety_Plugin::instance();
        if ($plugin->has_editable_workspace()) {
            $acknowledged = (string) wp_unslash($_POST['replace_acknowledged'] ?? '') === '1';
            $phrase = trim((string) wp_unslash($_POST['replace_phrase'] ?? ''));
            if (!$acknowledged || !hash_equals('APLICAR', $phrase)) {
                $this->redirect_error('A troca foi cancelada. Marque a confirmação e digite APLICAR.');
            }
        }
        try {
            $plugin->install_template_source(
                (string) $template['sourcePath'],
                sanitize_file_name((string) $template['slug']) . '-template.zip',
                (string) $template['name']
            );
            wp_safe_redirect(add_query_arg('kodety_template', rawurlencode($slug), home_url('/kodety/editor/')));
            exit;
        } catch (Throwable $error) {
            $this->redirect_error($error->getMessage());
        }
    }

    public function upload_template(): void {
        if (!current_user_can('kodety_import') || !current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE)) {
            wp_die('Sem permissão para adicionar templates.', '', ['response' => 403]);
        }
        check_admin_referer('kodety_upload_template');
        $file = $_FILES['template_zip'] ?? null;
        if (!is_array($file) || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            $this->redirect_error('Selecione um arquivo ZIP válido.');
        }
        try {
            $this->store_uploaded_template($file, [
                'name' => (string) wp_unslash($_POST['template_name'] ?? ''),
                'category' => (string) wp_unslash($_POST['template_category'] ?? 'other'),
                'description' => (string) wp_unslash($_POST['template_description'] ?? ''),
            ]);
            wp_safe_redirect(admin_url('admin.php?page=kodety-templates&kodety_template_notice=uploaded'));
            exit;
        } catch (Throwable $error) {
            $this->redirect_error($error->getMessage());
        }
    }

    /** @param array<string,mixed> $file @param array<string,string> $fields @return array<string,mixed> */
    private function store_uploaded_template(array $file, array $fields): array {
        $temporary = (string) ($file['tmp_name'] ?? '');
        if ($temporary === '' || !is_uploaded_file($temporary)) throw new RuntimeException('A origem do upload não pôde ser confirmada.');
        $size = (int) (filesize($temporary) ?: 0);
        if ($size <= 0 || $size > min((int) wp_max_upload_size(), self::MAX_TOTAL_BYTES)) {
            throw new RuntimeException('O ZIP está vazio ou excede o limite permitido pelo servidor.');
        }
        $inspection = $this->inspect_zip($temporary);
        $submitted_name = substr(sanitize_text_field($fields['name'] ?? ''), 0, 120);
        $name = $submitted_name !== '' ? $submitted_name : (string) $inspection['name'];
        if ($name === '') $name = sanitize_text_field(pathinfo((string) ($file['name'] ?? 'Template'), PATHINFO_FILENAME));
        if ($name === '') $name = 'Template importado';
        $category = sanitize_key($fields['category'] ?? 'other');
        if (!in_array($category, ['ecommerce', 'landing-page', 'business', 'portfolio', 'blog', 'other'], true)) $category = 'other';
        $description = substr(sanitize_textarea_field($fields['description'] ?? ''), 0, 360);
        if ($description === '') $description = 'Template completo enviado para a biblioteca deste site.';
        $hash = hash_file('sha256', $temporary);
        if (!is_string($hash) || $hash === '') throw new RuntimeException('Não foi possível validar o arquivo enviado.');
        $base_slug = sanitize_title($name) ?: 'template';
        $slug = substr($base_slug, 0, 56) . '-' . substr($hash, 0, 8);
        $directory = trailingslashit($this->user_directory) . $slug;
        if (is_dir($directory)) $directory .= '-' . substr(bin2hex(random_bytes(4)), 0, 8);
        if (!wp_mkdir_p($directory)) throw new RuntimeException('Não foi possível criar a pasta privada do template.');
        $target = $directory . '/project.zip';
        if (!move_uploaded_file($temporary, $target)) throw new RuntimeException('Não foi possível armazenar o template.');
        $manifest = [
            'schemaVersion' => self::SCHEMA_VERSION,
            'slug' => basename($directory),
            'name' => $name,
            'description' => $description,
            'category' => $category,
            'badge' => strtoupper(substr($name, 0, 2)),
            'pages' => (int) $inspection['pages'],
            'createdAt' => current_time('c'),
            'originalName' => sanitize_file_name((string) ($file['name'] ?? 'template.zip')),
        ];
        if (file_put_contents($directory . '/' . self::MANIFEST, (string) wp_json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX) === false) {
            @unlink($target);
            @rmdir($directory);
            throw new RuntimeException('Não foi possível salvar os dados do template.');
        }
        if (!is_file($this->user_directory . '/index.php')) {
            file_put_contents($this->user_directory . '/index.php', "<?php // Private Onun Kodety templates.\n", LOCK_EX);
        }
        return $manifest;
    }

    /** @return list<array<string,mixed>> */
    private function scan_catalog(string $root, string $origin): array {
        if (!is_dir($root) || is_link($root)) return [];
        $sources = [];
        foreach (scandir($root) ?: [] as $item) {
            if ($item === '.' || $item === '..') continue;
            $directory = $root . '/' . $item;
            $manifest_path = $directory . '/' . self::MANIFEST;
            if (!is_dir($directory) || is_link($directory) || !is_file($manifest_path)) continue;
            $manifest = json_decode((string) file_get_contents($manifest_path), true);
            if (!is_array($manifest) || (int) ($manifest['schemaVersion'] ?? 0) !== self::SCHEMA_VERSION) continue;
            $source_path = is_file($directory . '/project.zip') ? $directory . '/project.zip' : $directory . '/project';
            $sources[] = array_merge($manifest, [
                'sourcePath' => $source_path,
                'origin' => $origin,
            ]);
        }
        return $sources;
    }

    /** @param array<string,mixed> $source @return array<string,mixed>|null */
    private function normalize_template(array $source): ?array {
        $path = (string) ($source['sourcePath'] ?? '');
        $resolved = realpath($path);
        if (!is_string($resolved) || (!is_file($resolved) && !is_dir($resolved)) || is_link($path)) return null;
        $slug = sanitize_key((string) ($source['slug'] ?? basename(dirname($resolved))));
        $name = substr(sanitize_text_field((string) ($source['name'] ?? '')), 0, 120);
        if ($slug === '' || $name === '') return null;
        $category = sanitize_key((string) ($source['category'] ?? 'other'));
        if (!in_array($category, ['ecommerce', 'landing-page', 'business', 'portfolio', 'blog', 'other'], true)) $category = 'other';
        $origin = sanitize_key((string) ($source['origin'] ?? 'extension'));
        $pages = absint($source['pages'] ?? 0);
        if ($pages <= 0) $pages = $this->count_pages($resolved);
        return [
            'slug' => $slug,
            'name' => $name,
            'description' => substr(sanitize_textarea_field((string) ($source['description'] ?? 'Template completo para Onun Kodety.')), 0, 360),
            'category' => $category,
            'badge' => substr(sanitize_text_field((string) ($source['badge'] ?? 'KT')), 0, 12),
            'pages' => max(1, $pages),
            'featured' => !empty($source['featured']),
            'sourcePath' => $resolved,
            'origin' => $origin,
            'sourceLabel' => match ($origin) {
                'bundled' => 'Incluído no Onun Kodety',
                'uploaded' => 'Seu template',
                default => 'Extensão Onun Kodety',
            },
        ];
    }

    private function count_pages(string $source): int {
        if (is_file($source)) {
            try {
                return (int) $this->inspect_zip($source)['pages'];
            } catch (Throwable) {
                return 0;
            }
        }
        $count = 0;
        try {
            $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS));
            foreach ($iterator as $file) if ($file->isFile() && !$file->isLink() && preg_match('/\.html?$/i', $file->getFilename())) $count++;
        } catch (Throwable) {
            return 0;
        }
        return $count;
    }

    /** @return array{name:string,pages:int} */
    private function inspect_zip(string $path): array {
        if (!class_exists('ZipArchive')) throw new RuntimeException('A extensão PHP ZipArchive precisa estar habilitada.');
        $zip = new ZipArchive();
        if ($zip->open($path) !== true) throw new RuntimeException('O arquivo enviado não é um ZIP válido.');
        $pages = 0;
        $shopify_sections = 0;
        $shopify_layout = false;
        $total = 0;
        $name = '';
        try {
            if ($zip->numFiles <= 0 || $zip->numFiles > self::MAX_FILES) throw new RuntimeException('O template está vazio ou possui arquivos demais.');
            for ($index = 0; $index < $zip->numFiles; $index++) {
                $stat = $zip->statIndex($index);
                $entry = str_replace('\\', '/', (string) ($stat['name'] ?? ''));
                $normalized = ltrim($entry, '/');
                if ($normalized === '' || str_starts_with($entry, '/') || str_contains($normalized, '../') || str_contains($normalized, "\0") || preg_match('~^[a-zA-Z]:/~', $entry)) {
                    throw new RuntimeException('O template contém um caminho inseguro.');
                }
                if ($this->zip_entry_is_link($zip, $index)) throw new RuntimeException('Links simbólicos não são permitidos no template.');
                $size = max(0, (int) ($stat['size'] ?? 0));
                if ($size > self::MAX_FILE_BYTES) throw new RuntimeException('Um arquivo do template excede 256 MB.');
                $total += $size;
                if ($total > self::MAX_TOTAL_BYTES) throw new RuntimeException('O template descompactado excede 768 MB.');
                $lower = strtolower($normalized);
                if (preg_match('~(?:^|/)(?:node_modules|\.git)(?:/|$)~', $lower)) throw new RuntimeException('Remova node_modules e .git antes de enviar o template.');
                if (preg_match('/\.(?:php\d*|phtml|phar|cgi|pl|py|sh|bash|exe|dll|so)$/i', $lower) || str_ends_with($lower, '/.htaccess') || $lower === '.htaccess') {
                    throw new RuntimeException('O template contém um arquivo executável bloqueado.');
                }
                if (preg_match('/\.html?$/i', $lower)) $pages++;
                if (preg_match('~(?:^|/)layout/theme\.liquid$~i', $lower)) $shopify_layout = true;
                if (preg_match('~(?:^|/)sections/[^/]+\.liquid$~i', $lower)) $shopify_sections++;
                if (str_ends_with($lower, '.incode/project.json') && $size > 0 && $size <= MB_IN_BYTES) {
                    $project = json_decode((string) $zip->getFromIndex($index), true);
                    if (is_array($project)) $name = substr(sanitize_text_field((string) ($project['name'] ?? '')), 0, 120);
                }
            }
        } finally {
            $zip->close();
        }
        if ($pages <= 0 && $shopify_layout && $shopify_sections > 0) $pages = $shopify_sections;
        if ($pages <= 0) throw new RuntimeException('O template precisa conter páginas HTML ou uma estrutura válida de tema Shopify.');
        return ['name' => $name, 'pages' => $pages];
    }

    private function zip_entry_is_link(ZipArchive $zip, int $index): bool {
        $opsys = 0;
        $attributes = 0;
        if (!$zip->getExternalAttributesIndex($index, $opsys, $attributes)) return false;
        if ($opsys !== ZipArchive::OPSYS_UNIX) return false;
        return (($attributes >> 16) & 0170000) === 0120000;
    }

    private function accent_for_slug(string $slug): string {
        $palette = ['#c9ff3d', '#AFAFFF', '#ff9c76', '#d8a7ff', '#65e3c2', '#ffd166'];
        return $palette[abs((int) crc32($slug)) % count($palette)];
    }

    private function redirect_error(string $message): void {
        set_transient('kodety_template_error_' . get_current_user_id(), sanitize_text_field($message), 120);
        wp_safe_redirect(admin_url('admin.php?page=kodety-templates&kodety_template_notice=error'));
        exit;
    }
}
