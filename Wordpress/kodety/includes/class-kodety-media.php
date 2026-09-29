<?php

defined('ABSPATH') || exit;

final class Kodety_Media {
    private static ?self $instance = null;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('init', [$this, 'register_folder_taxonomy']);
        add_action('rest_api_init', [$this, 'register_folder_routes']);
        add_filter('rest_attachment_query', [$this, 'filter_media_by_folder'], 10, 2);
        add_filter('rest_attachment_collection_params', [$this, 'media_collection_params']);
        add_action('admin_menu', [$this, 'replace_native_menu'], 1000);
        add_action('admin_enqueue_scripts', [$this, 'admin_assets']);
        add_action('admin_init', [$this, 'redirect_native_screens'], 40);
    }

    public function register_folder_taxonomy(): void {
        register_taxonomy('kodety_media_folder', ['attachment'], [
            'labels' => ['name' => 'Pastas de mídia', 'singular_name' => 'Pasta de mídia'],
            'public' => false,
            'show_ui' => false,
            'show_in_rest' => false,
            'hierarchical' => true,
            'rewrite' => false,
            'query_var' => false,
        ]);
    }

    public function register_folder_routes(): void {
        register_rest_field('attachment', 'kodety_folder_ids', [
            'get_callback' => function (array $object): ?array {
                $ids = $this->media_folder_ids((int) $object['id']);
                return is_wp_error($ids) ? null : $ids;
            },
            'schema' => ['type' => ['array', 'null'], 'items' => ['type' => 'integer'], 'context' => ['edit'], 'readonly' => true],
        ]);
        register_rest_route('kodety/v1', '/media-folders', [
            ['methods' => 'GET', 'callback' => [$this, 'rest_list_folders'], 'permission_callback' => [$this, 'can_manage_media']],
            [
                'methods' => 'POST',
                'callback' => [$this, 'rest_create_folder'],
                'permission_callback' => [$this, 'can_manage_folders'],
                'args' => [
                    'name' => ['required' => true, 'type' => 'string'],
                    'parent' => ['type' => 'integer', 'minimum' => 0, 'default' => 0],
                ],
            ],
        ]);
        register_rest_route('kodety/v1', '/media-folders/(?P<id>\d+)', [
            [
                'methods' => 'POST',
                'callback' => [$this, 'rest_update_folder'],
                'permission_callback' => [$this, 'can_manage_folders'],
                'args' => ['name' => ['required' => true, 'type' => 'string'], 'expectedRevision' => ['type' => 'string']],
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'rest_delete_folder'],
                'permission_callback' => [$this, 'can_manage_folders'],
                'args' => ['expectedDeleteRevision' => ['type' => 'string']],
            ],
        ]);
        register_rest_route('kodety/v1', '/media-folders/move', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_move_media'],
            'permission_callback' => [$this, 'can_manage_media'],
            'args' => [
                'ids' => ['required' => true, 'type' => 'array', 'items' => ['type' => 'integer'], 'maxItems' => 500],
                'folder_id' => ['type' => 'integer', 'minimum' => 0, 'default' => 0],
                'expectedFolders' => ['type' => 'object', 'additionalProperties' => ['type' => 'array', 'items' => ['type' => 'integer']]],
            ],
        ]);
        register_rest_route('kodety/v1', '/media-replace/(?P<id>\d+)', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_replace_media'],
            'permission_callback' => [$this, 'can_manage_media'],
        ]);
    }

    public function rest_replace_media(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $id = absint($request['id']);
        if (get_post_type($id) !== 'attachment') return new WP_Error('kodety_media_missing', 'Arquivo não encontrado.', ['status' => 404]);
        if (!current_user_can('edit_post', $id)) return new WP_Error('kodety_media_forbidden', 'Você não pode editar este arquivo.', ['status' => 403]);

        $files = $request->get_file_params();
        $file = $files['file'] ?? null;
        if (!is_array($file) || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || empty($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
            return new WP_Error('kodety_media_file', 'Envie um arquivo válido.', ['status' => 400]);
        }
        $actual_size = (int) filesize((string) $file['tmp_name']);
        if ($actual_size < 1 || $actual_size > wp_max_upload_size()) {
            return new WP_Error('kodety_media_size', sprintf('O arquivo excede o limite de %s.', size_format(wp_max_upload_size())), ['status' => 400]);
        }

        $path = get_attached_file($id);
        if (!$path || is_link($path) || !is_file($path) || !$this->path_is_in_uploads($path)) {
            return new WP_Error('kodety_media_path', 'O arquivo original não está em um local seguro da biblioteca.', ['status' => 409]);
        }
        if (!is_writable(dirname($path))) return new WP_Error('kodety_media_write', 'A pasta deste arquivo não permite substituição.', ['status' => 500]);
        if (function_exists('upload_is_user_over_quota') && upload_is_user_over_quota() && $actual_size > (int) filesize($path)) {
            return new WP_Error('kodety_media_quota', 'A cota de armazenamento foi atingida.', ['status' => 400]);
        }

        $check = wp_check_filetype_and_ext($file['tmp_name'], sanitize_file_name((string) $file['name']), get_allowed_mime_types());
        $current_ext = strtolower((string) pathinfo($path, PATHINFO_EXTENSION));
        if (empty($check['ext']) || empty($check['type'])) return new WP_Error('kodety_media_type', 'Tipo de arquivo não permitido.', ['status' => 400]);
        if (strtolower((string) $check['ext']) !== $current_ext) {
            return new WP_Error('kodety_media_ext', sprintf('Para manter a mesma URL, envie um arquivo %s.', strtoupper($current_ext)), ['status' => 400]);
        }

        $replaced = $this->replace_attachment_transaction($id, (string) $file['tmp_name'], $path, (string) $check['type']);
        if (is_wp_error($replaced)) return $replaced;

        $item = new WP_REST_Request('GET', '/wp/v2/media/' . $id);
        $item->set_param('context', 'edit');
        $result = rest_do_request($item);
        if ($result->is_error()) return new WP_REST_Response(['replaced' => true, 'id' => $id], 200);
        return new WP_REST_Response($result->get_data());
    }

    private function replace_attachment_transaction(int $id, string $uploaded, string $path, string $mime): bool|WP_Error {
        $directory = dirname($path);
        $backup_directory = $this->media_backup_directory();
        if ($backup_directory === '') return new WP_Error('kodety_media_backup', 'O armazenamento privado de backup não está disponível.', ['status' => 500]);
        $stage = tempnam($backup_directory, '.media-new-');
        if (!is_string($stage) || !unlink($stage) || !move_uploaded_file($uploaded, $stage)) {
            if (is_string($stage) && is_file($stage)) unlink($stage);
            return new WP_Error('kodety_media_write', 'Não foi possível preparar o novo arquivo.', ['status' => 500]);
        }
        @chmod($stage, 0644 & ~umask());

        $old_meta = wp_get_attachment_metadata($id);
        $old_meta = is_array($old_meta) ? $old_meta : [];
        $old_mime = (string) get_post_mime_type($id);
        $old_files = $this->attachment_metadata_files($path, $old_meta);
        $backups = [];
        $new_meta = null;
        $original_backup = tempnam($backup_directory, '.media-original-');
        $original_preserved = false;
        $original_needs_restore = false;
        $keep_original_backup = false;
        $keep_backups = [];

        try {
            if (!is_string($original_backup) || copy($path, $original_backup) === false) {
                throw new RuntimeException('Não foi possível preservar o arquivo original.');
            }
            $original_preserved = true;
            foreach ($old_files as $old_file) {
                if ($old_file === $path || !is_file($old_file) || is_link($old_file)) continue;
                $backup = tempnam($backup_directory, '.media-size-');
                if (!is_string($backup) || copy($old_file, $backup) === false) {
                    if (is_string($backup) && is_file($backup)) unlink($backup);
                    throw new RuntimeException('Não foi possível preservar os tamanhos existentes.');
                }
                $backups[$old_file] = $backup;
            }

            // POSIX replaces atomically. The fallback supports filesystems that
            // require unlinking the destination, with the original already saved.
            if (rename($stage, $path)) {
                $original_needs_restore = true;
            } else {
                if (!unlink($path)) throw new RuntimeException('Não foi possível liberar o arquivo anterior.');
                $original_needs_restore = true;
                if (!rename($stage, $path)) throw new RuntimeException('Não foi possível ativar o novo arquivo.');
            }
            $stage = '';
            @chmod($path, 0644 & ~umask());

            $post_result = wp_update_post(['ID' => $id, 'post_mime_type' => $mime], true);
            if (is_wp_error($post_result)) throw new RuntimeException($post_result->get_error_message());
            clean_post_cache($id);
            require_once ABSPATH . 'wp-admin/includes/image.php';
            $generated = wp_generate_attachment_metadata($id, $path);
            if (wp_attachment_is_image($id) && (!is_array($generated) || empty($generated['file']))) {
                throw new RuntimeException('Não foi possível gerar metadados para a nova imagem.');
            }
            $new_meta = is_array($generated) ? $generated : [];
            wp_update_attachment_metadata($id, $new_meta);
            if ($new_meta !== [] && !is_array(wp_get_attachment_metadata($id))) {
                throw new RuntimeException('Os novos metadados não puderam ser persistidos.');
            }

            $new_files = array_fill_keys($this->attachment_metadata_files($path, $new_meta), true);
            foreach ($old_files as $old_file) {
                if ($old_file !== $path && !isset($new_files[$old_file]) && is_file($old_file) && !is_link($old_file)) unlink($old_file);
            }
            if (is_file($original_backup)) unlink($original_backup);
            foreach ($backups as $backup) if (is_file($backup)) unlink($backup);
            clean_post_cache($id);
            return true;
        } catch (Throwable $error) {
            $rollback_complete = true;
            if (is_array($new_meta)) {
                $old_lookup = array_fill_keys($old_files, true);
                foreach ($this->attachment_metadata_files($path, $new_meta) as $new_file) {
                    if ($new_file !== $path && !isset($old_lookup[$new_file]) && is_file($new_file) && !is_link($new_file)) unlink($new_file);
                }
            }
            if ($original_needs_restore && $original_preserved && is_string($original_backup) && is_file($original_backup)) {
                $original_restored = false;
                $failed = tempnam($directory, '.kodety-failed-');
                if (is_string($failed)) {
                    unlink($failed);
                    if (is_file($path)) rename($path, $failed);
                    $original_restored = rename($original_backup, $path) || copy($original_backup, $path);
                    if (is_file($failed)) unlink($failed);
                } else {
                    $original_restored = copy($original_backup, $path);
                }
                if (!$original_restored) {
                    $rollback_complete = false;
                    $keep_original_backup = true;
                }
            } elseif ($original_needs_restore) {
                $rollback_complete = false;
            }
            if ($original_needs_restore) foreach ($backups as $old_file => $backup) {
                if (is_file($backup) && copy($backup, $old_file)) {
                    unlink($backup);
                } else {
                    $rollback_complete = false;
                    $keep_backups[$old_file] = true;
                }
            }
            if ($original_needs_restore) {
                $post_rollback = wp_update_post(['ID' => $id, 'post_mime_type' => $old_mime], true);
                if (is_wp_error($post_rollback)) $rollback_complete = false;
                if ($old_meta !== []) {
                    wp_update_attachment_metadata($id, $old_meta);
                    if (!is_array(wp_get_attachment_metadata($id))) $rollback_complete = false;
                } else {
                    delete_post_meta($id, '_wp_attachment_metadata');
                }
            }
            clean_post_cache($id);
            error_log('[Onun Kodety] Falha na substituição de mídia do anexo ' . $id . '; rollback ' . ($rollback_complete ? 'concluído' : 'incompleto') . ': ' . $error->getMessage());
            if (!$rollback_complete) {
                return new WP_Error('kodety_media_rollback_failed', 'A substituição falhou e a recuperação automática ficou incompleta. O erro foi registrado e os backups recuperáveis foram preservados.', ['status' => 500]);
            }
            return new WP_Error('kodety_media_replace_failed', 'A substituição falhou e o arquivo anterior foi restaurado.', ['status' => 500]);
        } finally {
            if ($stage !== '' && is_file($stage)) unlink($stage);
            if (!$keep_original_backup && is_string($original_backup) && is_file($original_backup)) unlink($original_backup);
            foreach ($backups as $old_file => $backup) if (!isset($keep_backups[$old_file]) && is_file($backup)) unlink($backup);
        }
    }

    private function attachment_metadata_files(string $path, array $metadata): array {
        $files = [$path => true];
        $collect = static function (mixed $value) use (&$collect, &$files, $path): void {
            if (!is_array($value)) return;
            foreach ($value as $key => $item) {
                if (in_array((string) $key, ['file', 'original_image'], true) && is_string($item) && $item !== '') {
                    $candidate = dirname($path) . '/' . basename(str_replace('\\', '/', $item));
                    $files[$candidate] = true;
                } elseif (is_array($item)) {
                    $collect($item);
                }
            }
        };
        $collect($metadata);
        return array_keys($files);
    }

    private function path_is_in_uploads(string $path): bool {
        $uploads = wp_get_upload_dir();
        $base = !empty($uploads['basedir']) ? realpath((string) $uploads['basedir']) : false;
        $file = realpath($path);
        if (!is_string($base) || !is_string($file)) return false;
        $base = untrailingslashit(wp_normalize_path($base));
        $file = wp_normalize_path($file);
        return str_starts_with($file, trailingslashit($base));
    }

    private function media_backup_directory(): string {
        $uploads = wp_get_upload_dir();
        if (!empty($uploads['error']) || empty($uploads['basedir'])) return '';
        $private = trailingslashit((string) $uploads['basedir']) . 'kodety/private';
        if (!is_dir($private) || !is_writable($private)) return '';
        $backups = $private . '/media-backups';
        if (!wp_mkdir_p($backups) && !is_dir($backups)) return '';
        return is_writable($backups) ? $backups : '';
    }

    public function can_manage_media(): bool {
        return current_user_can('upload_files');
    }

    public function can_manage_folders(): bool {
        return current_user_can('upload_files') && current_user_can('manage_categories');
    }

    private function folder_payload(WP_Term $term): array {
        $revision = hash('sha256', (string) wp_json_encode([$term->term_id, $term->name, $term->parent]));
        // Deletion also removes relationships and reparents children. Hash IDs,
        // not just counts: two different sets can have the same size.
        $children = get_terms(['taxonomy' => 'kodety_media_folder', 'hide_empty' => false, 'parent' => $term->term_id, 'fields' => 'ids']);
        $objects = get_objects_in_term($term->term_id, 'kodety_media_folder');
        $delete_revision = '';
        if (!is_wp_error($children) && !is_wp_error($objects)) {
            $children = array_map('intval', $children);
            $objects = array_map('intval', $objects);
            sort($children, SORT_NUMERIC);
            sort($objects, SORT_NUMERIC);
            $delete_revision = hash('sha256', (string) wp_json_encode([$revision, $children, $objects]));
        }
        return ['id' => $term->term_id, 'name' => $term->name, 'parent' => $term->parent, 'count' => $term->count, 'revision' => $revision, 'deleteRevision' => $delete_revision];
    }

    private function media_folder_ids(int $id): array|WP_Error {
        $ids = wp_get_object_terms($id, 'kodety_media_folder', ['fields' => 'ids']);
        if (is_wp_error($ids)) return $ids;
        $ids = array_map('intval', $ids);
        sort($ids, SORT_NUMERIC);
        return $ids;
    }

    /** Serialize the comparison and mutation, never the lifetime of a browser tab. */
    private function with_folder_mutation(callable $operation): mixed {
        $uploads = wp_get_upload_dir();
        $directory = !empty($uploads['basedir']) ? trailingslashit($uploads['basedir']) . 'kodety/private' : '';
        if ($directory === '' || (!wp_mkdir_p($directory) && !is_dir($directory))) {
            return new WP_Error('kodety_folder_storage', 'Não foi possível preparar a gravação das pastas.', ['status' => 503]);
        }
        $handle = fopen($directory . '/.media-folders.lock', 'c+');
        if (!$handle || !flock($handle, LOCK_EX)) {
            if (is_resource($handle)) fclose($handle);
            return new WP_Error('kodety_folder_busy', 'As pastas estão sendo atualizadas. Tente novamente.', ['status' => 503]);
        }
        try {
            // A permission callback or REST response may have warmed this
            // request's term-query cache before it waited for the file lock.
            wp_cache_delete('last_changed', 'terms');
            return $operation();
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    private function folder_revision_error(WP_REST_Request $request, array $folder, bool $deleting = false): ?WP_Error {
        $expected = (string) $request->get_param($deleting ? 'expectedDeleteRevision' : 'expectedRevision');
        $actual = $folder[$deleting ? 'deleteRevision' : 'revision'];
        if ($expected !== '' && $actual !== '' && hash_equals($actual, $expected)) return null;
        return new WP_Error('kodety_folder_conflict', 'Esta pasta foi alterada em outra sessão. Recarregue as pastas antes de tentar novamente.', ['status' => 409, 'folder' => $folder]);
    }

    private function limit_text(string $value, int $length): string {
        return function_exists('mb_substr') ? mb_substr($value, 0, $length) : substr($value, 0, $length);
    }

    public function rest_list_folders(): WP_REST_Response {
        $terms = get_terms(['taxonomy' => 'kodety_media_folder', 'hide_empty' => false, 'orderby' => 'name', 'order' => 'ASC']);
        if (is_wp_error($terms)) return new WP_REST_Response(['message' => $terms->get_error_message()], 500);
        return new WP_REST_Response(array_map(fn(WP_Term $term): array => $this->folder_payload($term), $terms));
    }

    public function rest_create_folder(WP_REST_Request $request): WP_REST_Response|WP_Error {
        return $this->with_folder_mutation(fn() => $this->create_folder($request));
    }

    private function create_folder(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $name = $this->limit_text(sanitize_text_field((string) $request->get_param('name')), 80);
        $parent = absint($request->get_param('parent'));
        if ($name === '') return new WP_Error('kodety_folder_name', 'Informe um nome para a pasta.', ['status' => 400]);
        if ($parent && !term_exists($parent, 'kodety_media_folder')) return new WP_Error('kodety_folder_parent', 'A pasta superior não existe mais.', ['status' => 404]);
        $created = wp_insert_term($name, 'kodety_media_folder', ['parent' => $parent]);
        if (is_wp_error($created)) return new WP_Error('kodety_folder_create', $created->get_error_message(), ['status' => 400]);
        $term = get_term((int) $created['term_id'], 'kodety_media_folder');
        if (!$term instanceof WP_Term) return new WP_Error('kodety_folder_read', 'A pasta foi criada, mas não pôde ser recarregada.', ['status' => 500]);
        return new WP_REST_Response($this->folder_payload($term), 201);
    }

    public function rest_update_folder(WP_REST_Request $request): WP_REST_Response|WP_Error {
        return $this->with_folder_mutation(fn() => $this->update_folder($request));
    }

    private function update_folder(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $id = absint($request['id']);
        clean_term_cache($id, 'kodety_media_folder');
        if (!$id || !term_exists($id, 'kodety_media_folder')) return new WP_Error('kodety_folder_missing', 'Pasta não encontrada.', ['status' => 404]);
        $name = $this->limit_text(sanitize_text_field((string) $request->get_param('name')), 80);
        if ($name === '') return new WP_Error('kodety_folder_name', 'Informe um nome para a pasta.', ['status' => 400]);
        $current = get_term($id, 'kodety_media_folder');
        if (!$current instanceof WP_Term) return new WP_Error('kodety_folder_missing', 'Pasta não encontrada.', ['status' => 404]);
        $conflict = $this->folder_revision_error($request, $this->folder_payload($current));
        if ($conflict) return $conflict;
        $updated = wp_update_term($id, 'kodety_media_folder', ['name' => $name]);
        if (is_wp_error($updated)) return new WP_Error('kodety_folder_update', $updated->get_error_message(), ['status' => 400]);
        $term = get_term($id, 'kodety_media_folder');
        if (!$term instanceof WP_Term) return new WP_Error('kodety_folder_read', 'A pasta foi atualizada, mas não pôde ser recarregada.', ['status' => 500]);
        return new WP_REST_Response($this->folder_payload($term));
    }

    public function rest_delete_folder(WP_REST_Request $request): WP_REST_Response|WP_Error {
        return $this->with_folder_mutation(fn() => $this->delete_folder($request));
    }

    private function delete_folder(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $id = absint($request['id']);
        clean_term_cache($id, 'kodety_media_folder');
        $current = get_term($id, 'kodety_media_folder');
        if (!$current instanceof WP_Term) return new WP_Error('kodety_folder_delete', 'Pasta não encontrada.', ['status' => 404]);
        $conflict = $this->folder_revision_error($request, $this->folder_payload($current), true);
        if ($conflict) return $conflict;
        $deleted = wp_delete_term($id, 'kodety_media_folder');
        if (is_wp_error($deleted) || !$deleted) return new WP_Error('kodety_folder_delete', is_wp_error($deleted) ? $deleted->get_error_message() : 'Pasta não encontrada.', ['status' => 404]);
        return new WP_REST_Response(['deleted' => true, 'id' => $id]);
    }

    public function rest_move_media(WP_REST_Request $request): WP_REST_Response|WP_Error {
        return $this->with_folder_mutation(fn() => $this->move_media($request));
    }

    private function move_media(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $ids = array_slice(array_values(array_unique(array_filter(array_map('absint', (array) $request->get_param('ids'))))), 0, 500);
        $folder_id = absint($request->get_param('folder_id'));
        if (!$ids) return new WP_Error('kodety_media_ids', 'Selecione ao menos um arquivo.', ['status' => 400]);
        if ($folder_id && !term_exists($folder_id, 'kodety_media_folder')) return new WP_Error('kodety_folder_missing', 'A pasta selecionada não existe mais.', ['status' => 404]);
        $expected = $request->get_param('expectedFolders');
        $expected = is_array($expected) ? $expected : [];
        $conflicts = [];
        foreach ($ids as $id) {
            if (get_post_type($id) !== 'attachment' || !current_user_can('edit_post', $id)) continue;
            $before = $expected[$id] ?? null;
            if (!is_array($before)) { $conflicts[] = $id; continue; }
            $before = array_map('intval', $before);
            sort($before, SORT_NUMERIC);
            clean_object_term_cache($id, 'attachment');
            if ($before !== $this->media_folder_ids($id)) $conflicts[] = $id;
        }
        if ($conflicts) return new WP_Error('kodety_media_folder_conflict', 'A pasta de um arquivo foi alterada em outra sessão. Recarregue as mídias antes de mover novamente.', ['status' => 409, 'ids' => $conflicts]);
        $moved = 0;
        $failed = [];
        foreach ($ids as $id) {
            if (get_post_type($id) !== 'attachment' || !current_user_can('edit_post', $id)) { $failed[] = $id; continue; }
            $result = wp_set_object_terms($id, $folder_id ? [$folder_id] : [], 'kodety_media_folder', false);
            if (is_wp_error($result)) $failed[] = $id; else $moved++;
        }
        return new WP_REST_Response(['moved' => $moved, 'failed' => $failed]);
    }

    public function filter_media_by_folder(array $args, WP_REST_Request $request): array {
        $value = $request->get_param('kodety_folder');
        if ($value !== null && $value !== '') {
            $folder_id = absint($value);
            $clause = $folder_id
                ? ['taxonomy' => 'kodety_media_folder', 'field' => 'term_id', 'terms' => [$folder_id], 'include_children' => false]
                : ['taxonomy' => 'kodety_media_folder', 'operator' => 'NOT EXISTS'];
            $args['tax_query'] = isset($args['tax_query']) && is_array($args['tax_query']) ? $args['tax_query'] : [];
            $args['tax_query'][] = $clause;
        }

        // O card "Documentos" conta tudo que não é imagem, vídeo ou áudio.
        // `media_type=application` deixava fontes e text/* fora da consulta,
        // portanto o total do card e a grade discordavam.
        if ($request->get_param('kodety_media_kind') === 'document') {
            $mimes = array_values(array_unique(array_filter(
                array_map('strval', get_allowed_mime_types()),
                static fn(string $mime): bool =>
                    !str_starts_with($mime, 'image/')
                    && !str_starts_with($mime, 'video/')
                    && !str_starts_with($mime, 'audio/')
            )));
            $args['post_mime_type'] = $mimes ?: ['application/octet-stream'];
        }
        return $args;
    }

    public function media_collection_params(array $params): array {
        $params['kodety_media_kind'] = [
            'description' => 'Classificação agregada usada pela biblioteca Onun Kodety.',
            'type' => 'string',
            'enum' => ['document'],
        ];
        return $params;
    }

    public function replace_native_menu(): void {
        remove_menu_page('upload.php');
        $i18n = class_exists('Kodety_Admin_I18n') ? Kodety_Admin_I18n::instance() : null;
        add_menu_page(
            $i18n ? $i18n->translate('Mídias Onun Kodety') : 'Mídias Onun Kodety',
            $i18n ? $i18n->translate('Mídias') : 'Mídias',
            'upload_files',
            'kodety-media',
            [$this, 'render_page'],
            'dashicons-format-image',
            10
        );
        remove_submenu_page('kodety-media', 'kodety-media');
    }

    public function redirect_native_screens(): void {
        global $pagenow;
        if (!is_admin() || wp_doing_ajax() || !current_user_can('upload_files')) return;
        if (!in_array((string) $pagenow, ['upload.php', 'media-new.php'], true)) return;
        wp_safe_redirect(admin_url('admin.php?page=kodety-media'));
        exit;
    }

    public function admin_assets(string $hook): void {
        if ($hook !== 'toplevel_page_kodety-media') return;
        wp_enqueue_media();
        $css = KODETY_DIR . 'admin/media-library.css';
        $js = KODETY_DIR . 'admin/media-library.js';
        wp_enqueue_style('kodety-media-library', KODETY_URL . 'admin/media-library.css', [], is_file($css) ? (string) filemtime($css) : KODETY_VERSION);
        wp_enqueue_script('kodety-media-library', KODETY_URL . 'admin/media-library.js', [], is_file($js) ? (string) filemtime($js) : KODETY_VERSION, true);
        wp_localize_script('kodety-media-library', 'kodetyMediaLibrary', [
            'endpoint' => rest_url('wp/v2/media'),
            'foldersEndpoint' => rest_url('kodety/v1/media-folders'),
            'moveEndpoint' => rest_url('kodety/v1/media-folders/move'),
            'replaceEndpoint' => rest_url('kodety/v1/media-replace'),
            'nonce' => wp_create_nonce('wp_rest'),
            'canUpload' => current_user_can('upload_files'),
            'canDelete' => current_user_can('delete_posts'),
            'canManageFolders' => $this->can_manage_folders(),
            'maxUploadSize' => wp_max_upload_size(),
            'maxUploadLabel' => size_format(wp_max_upload_size()),
        ]);
    }

    private function counts(): array {
        global $wpdb;
        $counts = ['all' => 0, 'image' => 0, 'video' => 0, 'audio' => 0, 'document' => 0];
        $rows = $wpdb->get_results(
            "SELECT post_mime_type mime, COUNT(*) total FROM {$wpdb->posts} WHERE post_type='attachment' AND post_status='inherit' GROUP BY post_mime_type",
            ARRAY_A
        ) ?: [];
        foreach ($rows as $row) {
            $total = (int) $row['total'];
            $mime = strtolower((string) $row['mime']);
            $counts['all'] += $total;
            if (str_starts_with($mime, 'image/')) $counts['image'] += $total;
            elseif (str_starts_with($mime, 'video/')) $counts['video'] += $total;
            elseif (str_starts_with($mime, 'audio/')) $counts['audio'] += $total;
            else $counts['document'] += $total;
        }
        return $counts;
    }

    public function render_page(): void {
        if (!current_user_can('upload_files')) return;
        $counts = $this->counts();
        ?>
        <div class="wrap kodety-media-app" data-kodety-media-app>
            <header class="kodety-media-header">
                <div><p class="kodety-media-eyebrow">Conteúdo</p><h1>Mídias</h1><p>Organize imagens, vídeos, áudios e documentos do seu site.</p></div>
                <button type="button" class="button button-primary kodety-media-upload-button" data-kodety-media-upload><span data-kodety-icon="upload" aria-hidden="true"></span>Adicionar arquivos</button>
            </header>
            <section class="kodety-media-stats" aria-label="Resumo da biblioteca">
                <?php foreach ([['all','Todos','layers'],['image','Imagens','image'],['video','Vídeos','video'],['audio','Áudios','audio'],['document','Documentos','file']] as [$key,$label,$icon]): ?>
                    <button type="button" data-kodety-media-stat="<?php echo esc_attr($key); ?>" class="kodety-media-stat<?php echo $key === 'all' ? ' is-active' : ''; ?>">
                        <span class="kodety-media-stat__top"><span class="kodety-media-stat__icon" data-kodety-icon="<?php echo esc_attr($icon); ?>" aria-hidden="true"></span><span class="kodety-media-stat__label"><?php echo esc_html($label); ?></span></span>
                        <strong class="kodety-media-stat__value" data-kodety-media-count="<?php echo esc_attr($key); ?>"><?php echo Kodety_Admin_I18n::instance()->format_number($counts[$key]); ?></strong>
                    </button>
                <?php endforeach; ?>
            </section>
            <div class="kodety-media-workspace">
                <aside class="kodety-media-folders" aria-label="Pastas de mídia">
                    <header><div><p class="kodety-media-eyebrow">Organização</p><h2>Pastas</h2></div><button type="button" data-kodety-media-reload-folders aria-label="Atualizar pastas">↻</button><button type="button" data-kodety-media-new-folder aria-label="Criar pasta" <?php echo $this->can_manage_folders() ? '' : 'hidden'; ?>>+</button></header>
                    <form data-kodety-media-folder-form hidden><input type="text" maxlength="80" data-kodety-media-folder-name placeholder="Nome da pasta" aria-label="Nome da pasta"><div><button type="submit" class="button button-primary">Criar</button><button type="button" class="button" data-kodety-media-folder-cancel>Cancelar</button></div></form>
                    <nav data-kodety-media-folder-list>
                        <button type="button" class="is-current" data-kodety-media-folder=""><span>Todas as mídias</span><strong data-kodety-media-all-count><?php echo Kodety_Admin_I18n::instance()->format_number($counts['all']); ?></strong></button>
                        <button type="button" data-kodety-media-folder="0"><span>Sem pasta</span></button>
                        <div data-kodety-media-folder-items></div>
                    </nav>
                </aside>
                <main class="kodety-media-library">
                    <section class="kodety-media-toolbar" aria-label="Filtros da biblioteca">
                        <label class="kodety-media-search"><span data-kodety-icon="search" aria-hidden="true"></span><span class="screen-reader-text">Pesquisar mídias</span><input type="search" data-kodety-media-search placeholder="Pesquisar por nome ou legenda"></label>
                        <select data-kodety-media-type aria-label="Tipo de mídia"><option value="">Todos os tipos</option><option value="image">Imagens</option><option value="video">Vídeos</option><option value="audio">Áudios</option><option value="document">Documentos</option></select>
                        <select data-kodety-media-order aria-label="Ordenação"><option value="date-desc">Mais recentes</option><option value="date-asc">Mais antigos</option><option value="title-asc">Nome A–Z</option><option value="title-desc">Nome Z–A</option></select>
                        <span class="kodety-media-result-count" data-kodety-media-result-count>Carregando…</span>
                    </section>
                    <section class="kodety-media-selection" data-kodety-media-selection aria-live="polite">
                        <label><input type="checkbox" data-kodety-media-select-all><span>Selecionar carregados</span></label>
                        <strong data-kodety-media-selection-count>0 selecionados</strong>
                        <div class="kodety-media-move"><select data-kodety-media-folder-select aria-label="Pasta de destino" disabled><option value="">Mover para…</option><option value="0">Sem pasta</option></select><button type="button" class="button" data-kodety-media-move disabled>Mover</button></div>
                        <button type="button" class="button" data-kodety-media-clear-selection disabled>Limpar</button>
                        <?php if (current_user_can('delete_posts')): ?><button type="button" class="button kodety-media-bulk-delete" data-kodety-media-bulk-delete disabled>Excluir</button><?php endif; ?>
                    </section>
            <section class="kodety-media-dropzone" data-kodety-media-dropzone hidden><span data-kodety-icon="upload" aria-hidden="true"></span><strong>Solte os arquivos para enviar</strong><small>Limite por arquivo: <?php echo esc_html(size_format(wp_max_upload_size())); ?></small></section>
            <section class="kodety-media-grid" data-kodety-media-grid aria-live="polite"></section>
            <section class="kodety-media-empty" data-kodety-media-empty hidden><span data-kodety-icon="image" aria-hidden="true"></span><h2 data-kodety-media-empty-title>Nenhuma mídia encontrada</h2><p data-kodety-media-empty-message>Tente outro filtro ou adicione o primeiro arquivo.</p><button type="button" class="button" data-kodety-media-empty-action>Adicionar arquivos</button></section>
            <div class="kodety-media-loading" data-kodety-media-loading><span></span><span></span><span></span></div>
            <div class="kodety-media-more"><button type="button" class="button" data-kodety-media-more hidden>Carregar mais</button></div>
            <input type="file" multiple data-kodety-media-file-input hidden>
                </main>
            </div>

            <div class="kodety-media-detail" data-kodety-media-detail hidden>
                <div class="kodety-media-detail__backdrop" data-kodety-media-close></div>
                <aside class="kodety-media-detail__panel" role="dialog" aria-modal="true" aria-labelledby="kodety-media-detail-title" tabindex="-1">
                    <header><div><p class="kodety-media-eyebrow">Detalhes</p><h2 id="kodety-media-detail-title">Arquivo</h2></div><button type="button" data-kodety-media-close aria-label="Fechar"><span data-kodety-icon="x" data-kodety-icon-size="16" aria-hidden="true"></span></button></header>
                    <div class="kodety-media-detail__content">
                        <div class="kodety-media-detail__preview" data-kodety-media-preview></div>
                        <form data-kodety-media-form>
                            <label><span>Título</span><input name="title" autocomplete="off"></label>
                            <label><span>Texto alternativo</span><input name="alt_text" autocomplete="off"><small>Descreva a imagem para acessibilidade e SEO.</small></label>
                            <label><span>Legenda</span><textarea name="caption" rows="3"></textarea></label>
                            <label><span>Descrição</span><textarea name="description" rows="4"></textarea></label>
                            <label><span>URL do arquivo</span><div class="kodety-media-copy"><input name="source_url" readonly><button type="button" class="button" data-kodety-media-copy>Copiar</button></div></label>
                        </form>
                        <dl class="kodety-media-meta" data-kodety-media-meta></dl>
                    </div>
                    <footer><button type="button" class="button kodety-media-delete" data-kodety-media-delete>Excluir</button><button type="button" class="button" data-kodety-media-replace>Substituir arquivo</button><button type="button" class="button button-primary" data-kodety-media-save>Salvar alterações</button></footer>
                    <input type="file" data-kodety-media-replace-input hidden>
                </aside>
            </div>
            <div class="kodety-media-toast" data-kodety-media-toast role="status" hidden></div>
        </div>
        <?php
    }
}
