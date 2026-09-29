<?php

defined('ABSPATH') || exit;

/**
 * Persistent extension registry and package installer for Onun Kodety.
 *
 * Extension code lives beside (never inside) the editable site workspace. A
 * project publish/replacement can therefore swap the whole visual workspace
 * without touching installed modules or their WordPress options.
 */
final class Kodety_Extensions {
    private const OPTION_REGISTRY = 'kodety_extensions_registry';
    private const OPTION_SETTINGS = 'kodety_extension_settings';
    private const REGISTRY_VERSION = 1;
    private const MANIFEST_FILE = 'kodety-extension.json';
    private const BUNDLE_FILE = 'kodety-bundle.json';
    private const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
    private const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
    private const MAX_FILE_BYTES = 32 * 1024 * 1024;
    private const MAX_FILES = 2000;
    private const MAX_BUNDLE_PACKAGES = 50;
    private const ALLOWED_FILE_EXTENSIONS = [
        'php', 'js', 'mjs', 'cjs', 'css', 'json', 'html', 'htm', 'liquid', 'svg',
        'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico',
        'woff', 'woff2', 'ttf', 'otf', 'txt', 'md', 'csv', 'xml',
        'yaml', 'yml',
    ];

    private static ?self $instance = null;
    private string $storage_dir;
    /** @var array<string,bool> */
    private array $loaded = [];
    /** @var resource|null */
    private $mutation_lock = null;
    private int $mutation_lock_depth = 0;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        $uploads = wp_upload_dir();
        $base = is_array($uploads) ? (string) ($uploads['basedir'] ?? '') : '';
        if ($base === '') $base = WP_CONTENT_DIR . '/uploads';
        $default_storage = trailingslashit($base) . 'kodety-extensions';
        $configured_storage = defined('KODETY_EXTENSIONS_DIR')
            ? (string) KODETY_EXTENSIONS_DIR
            : $default_storage;
        $filtered_storage = apply_filters(
            'kodety_extensions_storage_dir',
            $configured_storage,
            $default_storage
        );
        $filtered_storage = is_string($filtered_storage)
            ? rtrim(str_replace('\\', '/', trim($filtered_storage)), '/')
            : '';
        $absolute = str_starts_with($filtered_storage, '/')
            || preg_match('/^[A-Za-z]:\//', $filtered_storage);
        $project_workspace = rtrim(str_replace('\\', '/', trailingslashit($base) . 'kodety'), '/');
        $unsafe = $filtered_storage === ''
            || $filtered_storage === '/'
            || preg_match('/^[A-Za-z]:$/', $filtered_storage)
            || $filtered_storage === rtrim(str_replace('\\', '/', WP_CONTENT_DIR), '/')
            || $filtered_storage === rtrim(str_replace('\\', '/', ABSPATH), '/')
            || $filtered_storage === $project_workspace
            || str_starts_with($filtered_storage, $project_workspace . '/');
        $this->storage_dir = $absolute && !$unsafe ? $filtered_storage : $default_storage;

        add_action('plugins_loaded', [$this, 'load_active'], 8);
        add_action('admin_post_kodety_install_extension', [$this, 'admin_install']);
        add_action('admin_post_kodety_activate_extension', [$this, 'admin_activate']);
        add_action('admin_post_kodety_deactivate_extension', [$this, 'admin_deactivate']);
        add_action('admin_post_kodety_remove_extension', [$this, 'admin_uninstall']);
    }

    public static function activate(): void {
        $manager = self::instance();
        $manager->ensure_storage();
        add_option(self::OPTION_REGISTRY, [
            'version' => self::REGISTRY_VERSION,
            'extensions' => [],
        ], '', false);
        add_option(self::OPTION_SETTINGS, [], '', false);
    }

    public static function max_archive_bytes(): int {
        return self::MAX_ARCHIVE_BYTES;
    }

    /**
     * Only inseparable core surfaces are bundled. Marketing, Membership and
     * Commerce remain normal uploaded extensions and therefore do not appear
     * installed on a fresh Builder installation.
     *
     * @return array<string,array<string,mixed>>
     */
    private function bundled_catalog(): array {
        $version = defined('KODETY_VERSION') ? (string) KODETY_VERSION : '0.0.0';
        return [
            'kodety-cms' => [
                'schemaVersion' => 1,
                'type' => 'extension',
                'slug' => 'kodety-cms',
                'name' => 'Onun Kodety CMS',
                'description' => 'Conteúdo, páginas dinâmicas e coleções conectadas ao Builder.',
                'version' => $version,
                'icon' => 'pages',
                'bundled' => true,
                'installed' => true,
                'active' => true,
                'required' => true,
            ],
            'kodety-analytics' => [
                'schemaVersion' => 1,
                'type' => 'extension',
                'slug' => 'kodety-analytics',
                'name' => 'Onun Kodety Analytics',
                'description' => 'Métricas, funis, testes A/B e integrações de mensuração.',
                'version' => $version,
                'icon' => 'analytics',
                'bundled' => true,
                'installed' => true,
                'active' => true,
                'required' => true,
            ],
            'kodety-settings' => [
                'schemaVersion' => 1,
                'type' => 'extension',
                'slug' => 'kodety-settings',
                'name' => 'Onun Kodety Settings',
                'description' => 'Preferências compartilhadas, segurança e configurações operacionais.',
                'version' => $version,
                'icon' => 'settings',
                'bundled' => true,
                'installed' => true,
                'active' => true,
                'required' => true,
            ],
            'kodety-emails' => [
                'schemaVersion' => 1,
                'type' => 'extension',
                'slug' => 'kodety-emails',
                'name' => 'Onun Kodety Emails',
                'description' => 'Caixa de formulários, entrega e integrações transacionais.',
                'version' => $version,
                'icon' => 'mail',
                'bundled' => true,
                'installed' => true,
                'active' => true,
                'required' => true,
            ],
        ];
    }

    /** @return array<string,array<string,mixed>> */
    public function catalog(): array {
        $registry = $this->registry();
        $catalog = $this->bundled_catalog();

        foreach ($catalog as $slug => &$item) {
            $override = is_array($registry[$slug] ?? null) ? $registry[$slug] : [];
            if (!empty($item['required'])) {
                $item['active'] = true;
            } elseif (array_key_exists('active', $override)) {
                $item['active'] = (bool) $override['active'];
            }
            $item['status'] = !empty($item['active']) ? 'active' : 'inactive';
        }
        unset($item);

        foreach ($registry as $slug => $record) {
            // A registry created by an older release may still contain the
            // former uploaded Analytics package. Bundled definitions always
            // win so that legacy files cannot replace native code at boot.
            if (isset($catalog[$slug]) || !is_array($record) || !empty($record['bundled'])) continue;
            $manifest = is_array($record['manifest'] ?? null) ? $record['manifest'] : [];
            if (!$manifest) continue;
            $catalog[$slug] = array_merge($manifest, [
                'slug' => $slug,
                'installed' => true,
                'active' => !empty($record['active']),
                'bundled' => false,
                'required' => false,
                'status' => !empty($record['active']) ? 'active' : 'inactive',
                'installedAt' => (string) ($record['installedAt'] ?? ''),
                'updatedAt' => (string) ($record['updatedAt'] ?? ''),
                'lastError' => sanitize_text_field((string) ($record['lastError'] ?? '')),
            ]);
        }

        $filtered = apply_filters('kodety_extensions_catalog', $catalog, $this);
        if (!is_array($filtered)) return $catalog;
        $normalized = [];
        foreach ($filtered as $key => $definition) {
            if (!is_array($definition)) continue;
            $slug = $this->sanitize_slug((string) ($definition['slug'] ?? (is_string($key) ? $key : '')));
            if ($slug === '') continue;
            $definition['slug'] = $slug;
            $normalized[$slug] = $definition;
        }
        return $normalized;
    }

    /** @return array<string,array<string,mixed>> */
    public function installed(): array {
        return array_filter(
            $this->catalog(),
            static fn(array $extension): bool => !empty($extension['installed'])
        );
    }

    /** @return array<string,mixed>|null */
    public function get(string $slug): ?array {
        $slug = $this->sanitize_slug($slug);
        if ($slug === '') return null;
        $catalog = $this->catalog();
        return is_array($catalog[$slug] ?? null) ? $catalog[$slug] : null;
    }

    public function is_active(string $slug): bool {
        $extension = $this->get($slug);
        return is_array($extension)
            && !empty($extension['installed'])
            && (!empty($extension['required']) || !empty($extension['active']));
    }

    /** @return list<string> */
    public function active_slugs(): array {
        return array_values(array_keys(array_filter(
            $this->installed(),
            static fn(array $extension): bool => !empty($extension['active']) || !empty($extension['required'])
        )));
    }

    public function storage_dir(): string {
        $this->ensure_storage();
        return $this->storage_dir;
    }

    /** @return array<string,mixed> */
    public function get_settings(string $slug, array $default = []): array {
        $slug = $this->sanitize_slug($slug);
        if ($slug === '') return $default;
        $all = get_option(self::OPTION_SETTINGS, []);
        $all = is_array($all) ? $all : [];
        return is_array($all[$slug] ?? null) ? $all[$slug] : $default;
    }

    public function update_settings(string $slug, array $settings): bool {
        $result = $this->with_mutation_lock(
            fn(): bool => $this->update_settings_unlocked($slug, $settings)
        );
        return is_bool($result) ? $result : false;
    }

    private function update_settings_unlocked(string $slug, array $settings): bool {
        $slug = $this->sanitize_slug($slug);
        if ($slug === '' || !$this->get($slug)) return false;
        $all = get_option(self::OPTION_SETTINGS, []);
        $all = is_array($all) ? $all : [];
        $previous = $all;
        if (($all[$slug] ?? null) === $settings) return true;
        $all[$slug] = $settings;
        if (update_option(self::OPTION_SETTINGS, $all, false)) return true;
        update_option(self::OPTION_SETTINGS, $previous, false);
        return false;
    }

    public function delete_settings(string $slug): bool {
        $result = $this->with_mutation_lock(
            fn(): bool => $this->delete_settings_unlocked($slug)
        );
        return is_bool($result) ? $result : false;
    }

    private function delete_settings_unlocked(string $slug): bool {
        $slug = $this->sanitize_slug($slug);
        if ($slug === '') return false;
        $all = get_option(self::OPTION_SETTINGS, []);
        $all = is_array($all) ? $all : [];
        if (!array_key_exists($slug, $all)) return true;
        unset($all[$slug]);
        return update_option(self::OPTION_SETTINGS, $all, false);
    }

    private function with_mutation_lock(callable $operation): mixed {
        $lock = $this->acquire_mutation_lock();
        if (is_wp_error($lock)) return $lock;
        try {
            return $operation();
        } finally {
            $this->release_mutation_lock();
        }
    }

    private function acquire_mutation_lock(): bool|WP_Error {
        if ($this->mutation_lock_depth > 0 && is_resource($this->mutation_lock)) {
            $this->mutation_lock_depth += 1;
            return true;
        }
        try {
            $this->ensure_storage();
        } catch (Throwable $error) {
            return new WP_Error('kodety_extensions_storage_failed', $error->getMessage());
        }
        $handle = @fopen($this->storage_dir . '/.registry.lock', 'c');
        if (!is_resource($handle)) {
            return new WP_Error('kodety_extensions_lock_failed', 'Não foi possível abrir o lock das extensões.');
        }
        if (!@flock($handle, LOCK_EX)) {
            fclose($handle);
            return new WP_Error('kodety_extensions_lock_failed', 'Não foi possível bloquear o registro das extensões.');
        }
        $this->mutation_lock = $handle;
        $this->mutation_lock_depth = 1;
        return true;
    }

    private function release_mutation_lock(): void {
        if ($this->mutation_lock_depth <= 0) return;
        $this->mutation_lock_depth -= 1;
        if ($this->mutation_lock_depth > 0 || !is_resource($this->mutation_lock)) return;
        @flock($this->mutation_lock, LOCK_UN);
        fclose($this->mutation_lock);
        $this->mutation_lock = null;
    }

    /**
     * Install one extension ZIP or an outer bundle.
     *
     * @return array{type:string,installed:list<array<string,mixed>>}|WP_Error
     */
    public function install_zip(string $archive_path): array|WP_Error {
        $result = $this->with_mutation_lock(
            fn(): array|WP_Error => $this->install_zip_unlocked($archive_path)
        );
        return is_array($result) || is_wp_error($result)
            ? $result
            : new WP_Error('kodety_extensions_install_failed', 'A instalação não retornou um resultado válido.');
    }

    /** @return array{type:string,installed:list<array<string,mixed>>}|WP_Error */
    private function install_zip_unlocked(string $archive_path): array|WP_Error {
        if (!class_exists('ZipArchive')) {
            return new WP_Error('kodety_extensions_zip_unavailable', 'A extensão ZIP do PHP é necessária para instalar extensões.');
        }
        $archive_error = $this->archive_file_error($archive_path);
        if ($archive_error) return $archive_error;
        try {
            $this->ensure_storage();
        } catch (Throwable $error) {
            return new WP_Error('kodety_extensions_storage_failed', $error->getMessage());
        }

        $outer = $this->extract_archive($archive_path, true);
        if (is_wp_error($outer)) return $outer;

        $prepared = [];
        $type = 'extension';
        try {
            $bundle_root = $this->manifest_root($outer, self::BUNDLE_FILE);
            $extension_root = $this->manifest_root($outer, self::MANIFEST_FILE);

            if ($bundle_root !== null && $extension_root !== null) {
                return new WP_Error('kodety_extensions_ambiguous_package', 'O ZIP mistura manifestos de extensão e bundle.');
            }

            if ($bundle_root !== null) {
                $type = 'bundle';
                $bundle = $this->read_json_manifest($bundle_root . '/' . self::BUNDLE_FILE);
                if (is_wp_error($bundle)) return $bundle;
                $packages = $this->normalize_bundle_manifest($bundle, $bundle_root);
                if (is_wp_error($packages)) return $packages;
                foreach ($packages as $package_path) {
                    $candidate = $this->prepare_extension_archive($package_path);
                    if (is_wp_error($candidate)) return $candidate;
                    $prepared[] = $candidate;
                    $limit_error = $this->prepared_limits_error($prepared);
                    if ($limit_error) return $limit_error;
                }
            } elseif ($extension_root !== null) {
                $prepared_extension = $this->prepare_extracted_extension($extension_root, $archive_path);
                if (is_wp_error($prepared_extension)) return $prepared_extension;
                // Ownership of the outer temp tree moves to this prepared item.
                $prepared_extension['cleanupRoot'] = $outer;
                $prepared[] = $prepared_extension;
                $outer = '';
                $limit_error = $this->prepared_limits_error($prepared);
                if ($limit_error) return $limit_error;
            } else {
                return new WP_Error(
                    'kodety_extensions_manifest_missing',
                    'O ZIP não contém kodety-extension.json nem kodety-bundle.json.'
                );
            }

            if (!$prepared) {
                return new WP_Error('kodety_extensions_bundle_empty', 'O bundle não contém extensões.');
            }
            $slugs = [];
            foreach ($prepared as $candidate) {
                $slug = (string) ($candidate['manifest']['slug'] ?? '');
                if ($slug === '' || isset($slugs[$slug])) {
                    return new WP_Error('kodety_extensions_duplicate_slug', 'O pacote contém extensões duplicadas.');
                }
                $slugs[$slug] = true;
            }

            $committed = $this->commit_prepared($prepared);
            if (is_wp_error($committed)) return $committed;
            return ['type' => $type, 'installed' => $committed];
        } catch (Throwable $error) {
            return new WP_Error('kodety_extensions_install_failed', $error->getMessage());
        } finally {
            if ($outer !== '') $this->remove_tree($outer);
            foreach ($prepared as $candidate) {
                $cleanup = (string) ($candidate['cleanupRoot'] ?? '');
                if ($cleanup !== '') $this->remove_tree($cleanup);
            }
        }
    }

    public function activate_extension(string $slug): bool|WP_Error {
        $result = $this->with_mutation_lock(
            fn(): bool|WP_Error => $this->activate_extension_unlocked($slug)
        );
        return is_bool($result) || is_wp_error($result)
            ? $result
            : new WP_Error('kodety_extension_activation_failed', 'A ativação não retornou um resultado válido.');
    }

    private function activate_extension_unlocked(string $slug): bool|WP_Error {
        $slug = $this->sanitize_slug($slug);
        $extension = $this->get($slug);
        if (!$extension || empty($extension['installed'])) {
            return new WP_Error('kodety_extension_not_installed', 'A extensão não está instalada.');
        }
        if ($this->is_active($slug)) return true;

        $dependencies = is_array($extension['dependencies'] ?? null)
            ? $extension['dependencies']
            : [];
        foreach ($dependencies as $dependency) {
            $dependency = $this->sanitize_slug((string) $dependency);
            if ($dependency !== '' && !$this->is_active($dependency)) {
                return new WP_Error(
                    'kodety_extension_dependency_inactive',
                    'Ative primeiro a dependência ' . $dependency . '.'
                );
            }
        }

        try {
            do_action('kodety_extension_before_activate', $slug, $extension, $this);
        } catch (Throwable $error) {
            return new WP_Error(
                'kodety_extension_activation_failed',
                'A extensão não pôde iniciar a ativação: ' . $error->getMessage()
            );
        }
        if (empty($extension['bundled'])) {
            $loaded = $this->load_external($slug);
            if (is_wp_error($loaded)) return $loaded;
        }

        $registry = $this->registry();
        $previous = $registry;
        $record = is_array($registry[$slug] ?? null) ? $registry[$slug] : [
            'bundled' => !empty($extension['bundled']),
        ];
        $record['active'] = true;
        $registry[$slug] = $record;
        if (!$this->write_registry($registry)) {
            return new WP_Error('kodety_extension_persistence_failed', 'Não foi possível confirmar a ativação no WordPress.');
        }
        try {
            do_action('kodety_extension_activate_' . $slug, $extension, $this);
            do_action('kodety_extension_after_activate', $slug, $extension, $this);
        } catch (Throwable $error) {
            $this->write_registry($previous);
            try {
                do_action('kodety_extension_deactivate_' . $slug, $extension, $this);
                do_action('kodety_extension_after_deactivate', $slug, $extension, $this);
            } catch (Throwable $rollback_error) {
                error_log(
                    '[Onun Kodety] Rollback da ativação de '
                    . $slug
                    . ' falhou: '
                    . $rollback_error->getMessage()
                );
            }
            return new WP_Error('kodety_extension_activation_failed', 'A extensão falhou ao ativar: ' . $error->getMessage());
        }
        return true;
    }

    public function deactivate_extension(string $slug): bool|WP_Error {
        $result = $this->with_mutation_lock(
            fn(): bool|WP_Error => $this->deactivate_extension_unlocked($slug)
        );
        return is_bool($result) || is_wp_error($result)
            ? $result
            : new WP_Error('kodety_extension_deactivation_failed', 'A desativação não retornou um resultado válido.');
    }

    private function deactivate_extension_unlocked(string $slug): bool|WP_Error {
        $slug = $this->sanitize_slug($slug);
        $extension = $this->get($slug);
        if (!$extension || empty($extension['installed'])) {
            return new WP_Error('kodety_extension_not_installed', 'A extensão não está instalada.');
        }
        if (!empty($extension['required'])) {
            return new WP_Error('kodety_extension_required', 'Esta extensão é necessária para o funcionamento do Onun Kodety.');
        }
        if (!$this->is_active($slug)) return true;

        $dependents = $this->active_dependents($slug);
        if ($dependents) {
            return new WP_Error(
                'kodety_extension_has_dependents',
                'Desative primeiro as extensões dependentes: ' . implode(', ', $dependents) . '.'
            );
        }
        try {
            do_action('kodety_extension_before_deactivate', $slug, $extension, $this);
        } catch (Throwable $error) {
            return new WP_Error(
                'kodety_extension_deactivation_failed',
                'A extensão não pôde iniciar a desativação: ' . $error->getMessage()
            );
        }
        $registry = $this->registry();
        $previous = $registry;
        $record = is_array($registry[$slug] ?? null) ? $registry[$slug] : [
            'bundled' => !empty($extension['bundled']),
        ];
        $record['active'] = false;
        $registry[$slug] = $record;
        if (!$this->write_registry($registry)) {
            return new WP_Error('kodety_extension_persistence_failed', 'Não foi possível confirmar a desativação no WordPress.');
        }
        try {
            do_action('kodety_extension_deactivate_' . $slug, $extension, $this);
            do_action('kodety_extension_after_deactivate', $slug, $extension, $this);
        } catch (Throwable $error) {
            $this->write_registry($previous);
            try {
                do_action('kodety_extension_activate_' . $slug, $extension, $this);
                do_action('kodety_extension_after_activate', $slug, $extension, $this);
            } catch (Throwable $rollback_error) {
                error_log(
                    '[Onun Kodety] Rollback da desativação de '
                    . $slug
                    . ' falhou: '
                    . $rollback_error->getMessage()
                );
            }
            return new WP_Error('kodety_extension_deactivation_failed', 'A extensão falhou ao desativar: ' . $error->getMessage());
        }
        return true;
    }

    public function uninstall(string $slug, bool $delete_settings = false): bool|WP_Error {
        $result = $this->with_mutation_lock(
            fn(): bool|WP_Error => $this->uninstall_unlocked($slug, $delete_settings)
        );
        return is_bool($result) || is_wp_error($result)
            ? $result
            : new WP_Error('kodety_extension_remove_failed', 'A remoção não retornou um resultado válido.');
    }

    private function uninstall_unlocked(string $slug, bool $delete_settings = false): bool|WP_Error {
        $slug = $this->sanitize_slug($slug);
        $extension = $this->get($slug);
        if (!$extension || empty($extension['installed'])) {
            return new WP_Error('kodety_extension_not_installed', 'A extensão não está instalada.');
        }
        if (!empty($extension['bundled'])) {
            return new WP_Error('kodety_extension_bundled', 'Extensões incluídas no Onun Kodety não podem ser removidas deste pacote.');
        }
        $dependents = $this->active_dependents($slug);
        if ($dependents) {
            return new WP_Error(
                'kodety_extension_has_dependents',
                'Desative primeiro as extensões dependentes: ' . implode(', ', $dependents) . '.'
            );
        }
        $was_active = $this->is_active($slug);
        $original_registry = $this->registry();
        $original_record = is_array($original_registry[$slug] ?? null)
            ? $original_registry[$slug]
            : [];
        try {
            do_action('kodety_extension_before_uninstall', $slug, $extension, $delete_settings, $this);
        } catch (Throwable $error) {
            return new WP_Error(
                'kodety_extension_remove_failed',
                'A extensão não pôde iniciar a remoção: ' . $error->getMessage()
            );
        }
        if ($was_active) {
            $deactivated = $this->deactivate_extension($slug);
            if (is_wp_error($deactivated)) return $deactivated;
        }

        $restore_state = function () use ($slug, $original_record, $was_active): bool {
            $registry = $this->registry();
            $record = $original_record;
            $record['active'] = false;
            $registry[$slug] = $record;
            if (!$this->write_registry($registry)) return false;
            if (!$was_active) return true;
            return $this->activate_extension_unlocked($slug) === true;
        };

        $destination = $this->extension_directory($slug);
        $quarantine = $this->storage_dir . '/.remove-' . $slug . '-' . $this->random_suffix();
        if (is_dir($destination) && !@rename($destination, $quarantine)) {
            $restored = $restore_state();
            return new WP_Error(
                'kodety_extension_remove_failed',
                'Não foi possível isolar os arquivos da extensão.'
                    . ($restored ? '' : ' O estado ativo também não pôde ser restaurado.')
            );
        }
        $registry = $this->registry();
        unset($registry[$slug]);
        if (!$this->write_registry($registry)) {
            if (is_dir($quarantine)) @rename($quarantine, $destination);
            $restored = $restore_state();
            return new WP_Error(
                'kodety_extension_persistence_failed',
                'Não foi possível confirmar a remoção no WordPress.'
                    . ($restored ? '' : ' O estado ativo também não pôde ser restaurado.')
            );
        }
        if ($delete_settings && !$this->delete_settings($slug)) {
            if (is_dir($quarantine)) @rename($quarantine, $destination);
            $restored = $restore_state();
            return new WP_Error(
                'kodety_extension_settings_remove_failed',
                'Os arquivos foram preservados porque as configurações não puderam ser removidas.'
                    . ($restored ? '' : ' O estado ativo também não pôde ser restaurado.')
            );
        }
        $this->remove_tree($quarantine);
        try {
            do_action('kodety_extension_after_uninstall', $slug, $extension, $delete_settings, $this);
        } catch (Throwable $error) {
            error_log(
                '[Onun Kodety] Falha no hook pós-remoção de '
                . $slug
                . ': '
                . $error->getMessage()
            );
        }
        return true;
    }

    public function load_active(): void {
        $result = $this->with_mutation_lock(fn(): bool|WP_Error => $this->load_active_unlocked());
        if (is_wp_error($result)) {
            error_log('[Onun Kodety] Falha ao carregar extensões: ' . $result->get_error_message());
        }
    }

    private function load_active_unlocked(): bool|WP_Error {
        $installed = $this->installed();
        $external = [];
        $available = [];
        foreach ($installed as $slug => $extension) {
            $slug = $this->sanitize_slug((string) $slug);
            if ($slug === '' || !$this->is_active($slug)) continue;
            if (!empty($extension['bundled'])) $available[$slug] = true;
            else $external[$slug] = $extension;
        }

        $invalid = [];
        foreach ($external as $slug => $extension) {
            foreach ((array) ($extension['dependencies'] ?? []) as $dependency) {
                $dependency = $this->sanitize_slug((string) $dependency);
                if (
                    $dependency === ''
                    || !isset($installed[$dependency])
                    || !$this->is_active($dependency)
                ) {
                    $invalid[$slug] = 'Dependência ausente ou inativa: ' . ($dependency ?: '(inválida)') . '.';
                    break;
                }
            }
        }
        do {
            $changed = false;
            foreach ($external as $slug => $extension) {
                if (isset($invalid[$slug])) continue;
                foreach ((array) ($extension['dependencies'] ?? []) as $dependency) {
                    $dependency = $this->sanitize_slug((string) $dependency);
                    if ($dependency === '' || !isset($invalid[$dependency])) continue;
                    $invalid[$slug] = 'Uma dependência não pôde ser carregada: ' . $dependency . '.';
                    $changed = true;
                    break;
                }
            }
        } while ($changed);

        $remaining = array_diff_key($external, $invalid);
        $order = [];
        while ($remaining) {
            $ready = [];
            foreach ($remaining as $slug => $extension) {
                $blocked = false;
                foreach ((array) ($extension['dependencies'] ?? []) as $dependency) {
                    $dependency = $this->sanitize_slug((string) $dependency);
                    if ($dependency !== '' && isset($remaining[$dependency])) {
                        $blocked = true;
                        break;
                    }
                }
                if (!$blocked) $ready[] = $slug;
            }
            if (!$ready) {
                foreach (array_keys($remaining) as $slug) {
                    $invalid[$slug] = 'Ciclo de dependências detectado.';
                }
                break;
            }
            sort($ready, SORT_STRING);
            foreach ($ready as $slug) {
                $order[] = $slug;
                unset($remaining[$slug]);
            }
        }

        $registry = $this->registry();
        $registry_changed = false;
        $deactivate = function (string $slug, string $message) use (&$registry, &$registry_changed): void {
            if (!isset($registry[$slug]) || !is_array($registry[$slug])) return;
            $registry[$slug]['active'] = false;
            $registry[$slug]['lastError'] = $message;
            $registry_changed = true;
            error_log('[Onun Kodety] Extensão ' . $slug . ' desativada: ' . $message);
        };
        foreach ($invalid as $slug => $message) $deactivate($slug, $message);

        foreach ($order as $slug) {
            if (isset($invalid[$slug])) continue;
            $extension = $external[$slug];
            $missing = '';
            foreach ((array) ($extension['dependencies'] ?? []) as $dependency) {
                $dependency = $this->sanitize_slug((string) $dependency);
                if ($dependency !== '' && !empty($available[$dependency])) continue;
                $missing = $dependency ?: '(inválida)';
                break;
            }
            if ($missing !== '') {
                $deactivate($slug, 'A dependência ' . $missing . ' falhou ao carregar.');
                continue;
            }

            $loaded = $this->load_external($slug);
            if (is_wp_error($loaded)) {
                $deactivate($slug, $loaded->get_error_message());
                continue;
            }

            $record = is_array($registry[$slug] ?? null) ? $registry[$slug] : [];
            if (!empty($record['pendingActivation'])) {
                try {
                    do_action('kodety_extension_activate_' . $slug, $extension, $this);
                    do_action('kodety_extension_after_activate', $slug, $extension, $this);
                    unset($record['pendingActivation']);
                    $record['lastError'] = '';
                    $registry[$slug] = $record;
                    $registry_changed = true;
                } catch (Throwable $error) {
                    $deactivate($slug, 'A migração da nova versão falhou: ' . $error->getMessage());
                    continue;
                }
            }
            $available[$slug] = true;
        }

        if ($registry_changed && !$this->write_registry($registry)) {
            return new WP_Error(
                'kodety_extension_persistence_failed',
                'Não foi possível persistir o resultado do carregamento das extensões.'
            );
        }
        try {
            do_action('kodety_extensions_loaded', $this);
        } catch (Throwable $error) {
            error_log('[Onun Kodety] Falha no hook kodety_extensions_loaded: ' . $error->getMessage());
        }
        return true;
    }

    private function load_external(string $slug): bool|WP_Error {
        if (!empty($this->loaded[$slug])) return true;
        $registry = $this->registry();
        $record = is_array($registry[$slug] ?? null) ? $registry[$slug] : [];
        $manifest = is_array($record['manifest'] ?? null) ? $record['manifest'] : [];
        $entry = (string) ($manifest['entry'] ?? '');
        if ($entry === '') return new WP_Error('kodety_extension_entry_missing', 'O manifesto não define um entrypoint.');
        $root = realpath($this->extension_directory($slug));
        $file = realpath($this->extension_directory($slug) . '/' . $entry);
        if (
            !$root
            || !$file
            || !str_starts_with($this->normalize_path($file), trailingslashit($this->normalize_path($root)))
            || !is_file($file)
        ) {
            return new WP_Error('kodety_extension_entry_invalid', 'O entrypoint da extensão não existe ou saiu da pasta instalada.');
        }
        $api_context = null;
        try {
            if (class_exists('Kodety_Extension_API')) {
                $api_context = Kodety_Extension_API::instance()->enter($slug, $manifest, $root);
            }
            require_once $file;
            $this->loaded[$slug] = true;
            do_action('kodety_extension_loaded', $slug, $manifest, $this);
            return true;
        } catch (Throwable $error) {
            return new WP_Error('kodety_extension_load_failed', $error->getMessage());
        } finally {
            if ($api_context instanceof Kodety_Extension_Context) {
                try {
                    Kodety_Extension_API::instance()->leave($slug);
                } catch (Throwable $error) {
                    error_log('[Onun Kodety] Falha ao fechar o contexto de ' . $slug . ': ' . $error->getMessage());
                }
            }
        }
    }

    /** @return array<string,array<string,mixed>> */
    private function registry(): array {
        $raw = get_option(self::OPTION_REGISTRY, []);
        if (!is_array($raw)) return [];
        $records = is_array($raw['extensions'] ?? null) ? $raw['extensions'] : $raw;
        $clean = [];
        foreach ($records as $slug => $record) {
            $slug = $this->sanitize_slug((string) $slug);
            if ($slug === '' || !is_array($record)) continue;
            $clean[$slug] = $record;
        }
        return $clean;
    }

    /** @param array<string,array<string,mixed>> $extensions */
    private function write_registry(array $extensions): bool {
        $payload = [
            'version' => self::REGISTRY_VERSION,
            'extensions' => $extensions,
        ];
        if (get_option(self::OPTION_REGISTRY, null) === $payload) return true;
        return update_option(self::OPTION_REGISTRY, $payload, false);
    }

    private function ensure_storage(): void {
        if (!is_dir($this->storage_dir) && !wp_mkdir_p($this->storage_dir)) {
            throw new RuntimeException('Não foi possível criar o diretório persistente de extensões.');
        }
        $guards = [
            'index.php' => "<?php\n// Silence is golden.\n",
            'index.html' => '',
            '.htaccess' => "Options -Indexes\n<FilesMatch \"\\.(?:php|phtml|phar)$\">\nRequire all denied\n</FilesMatch>\n",
            'web.config' => "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<configuration><system.webServer><directoryBrowse enabled=\"false\" /><security><requestFiltering><fileExtensions><add fileExtension=\".php\" allowed=\"false\" /></fileExtensions></requestFiltering></security></system.webServer></configuration>\n",
        ];
        foreach ($guards as $file => $contents) {
            $path = $this->storage_dir . '/' . $file;
            $written = @file_put_contents($path, $contents, LOCK_EX);
            if ($written !== strlen($contents)) {
                throw new RuntimeException(
                    'Não foi possível confirmar a proteção HTTP do diretório de extensões.'
                );
            }
            @chmod($path, 0644);
        }
    }

    private function archive_file_error(string $path): ?WP_Error {
        if (!is_file($path) || !is_readable($path)) {
            return new WP_Error('kodety_extensions_archive_missing', 'O ZIP enviado não está disponível.');
        }
        $size = (int) (filesize($path) ?: 0);
        if ($size <= 0 || $size > self::MAX_ARCHIVE_BYTES) {
            return new WP_Error('kodety_extensions_archive_size', 'O ZIP deve ter no máximo 256 MB.');
        }
        $handle = @fopen($path, 'rb');
        $magic = is_resource($handle) ? (string) fread($handle, 4) : '';
        if (is_resource($handle)) fclose($handle);
        if (!str_starts_with($magic, "PK\x03\x04") && !str_starts_with($magic, "PK\x05\x06")) {
            return new WP_Error('kodety_extensions_archive_invalid', 'O arquivo enviado não é um ZIP válido.');
        }
        return null;
    }

    /**
     * @return string|WP_Error absolute temporary extraction directory
     */
    private function extract_archive(string $archive_path, bool $allow_nested_zip): string|WP_Error {
        $zip = new ZipArchive();
        if ($zip->open($archive_path) !== true) {
            return new WP_Error('kodety_extensions_archive_open', 'Não foi possível abrir o ZIP.');
        }
        if ($zip->numFiles <= 0 || $zip->numFiles > self::MAX_FILES) {
            $zip->close();
            return new WP_Error('kodety_extensions_archive_files', 'O ZIP contém uma quantidade inválida de arquivos.');
        }

        $destination = $this->storage_dir . '/.extract-' . $this->random_suffix();
        if (!wp_mkdir_p($destination)) {
            $zip->close();
            return new WP_Error('kodety_extensions_temp_failed', 'Não foi possível preparar a validação do ZIP.');
        }

        $total = 0;
        try {
            for ($index = 0; $index < $zip->numFiles; $index += 1) {
                $stat = $zip->statIndex($index);
                if (!is_array($stat)) throw new RuntimeException('Entrada ZIP ilegível.');
                $name = $this->normalize_archive_entry((string) ($stat['name'] ?? ''));
                if ($name === '') continue;
                if (str_starts_with($name, '__MACOSX/') || basename($name) === '.DS_Store') continue;
                if ($this->zip_entry_is_link($zip, $index)) {
                    throw new RuntimeException('Links simbólicos não são aceitos em extensões.');
                }
                $directory = str_ends_with($name, '/');
                $relative = rtrim($name, '/');
                if ($relative === '') continue;
                $target = $destination . '/' . $relative;
                if ($directory) {
                    if (!is_dir($target) && !wp_mkdir_p($target)) throw new RuntimeException('Pasta ZIP inválida.');
                    continue;
                }

                $size = max(0, (int) ($stat['size'] ?? 0));
                $total += $size;
                if ($size > self::MAX_FILE_BYTES || $total > self::MAX_UNCOMPRESSED_BYTES) {
                    throw new RuntimeException('O conteúdo descompactado ultrapassa o limite seguro.');
                }
                $extension = strtolower(pathinfo($relative, PATHINFO_EXTENSION));
                if (
                    !in_array($extension, self::ALLOWED_FILE_EXTENSIONS, true)
                    && !($allow_nested_zip && $extension === 'zip')
                ) {
                    throw new RuntimeException('Tipo de arquivo não permitido no pacote: .' . ($extension ?: '(sem extensão)'));
                }
                $parent = dirname($target);
                if (!is_dir($parent) && !wp_mkdir_p($parent)) throw new RuntimeException('Pasta ZIP inválida.');
                $input = $zip->getStream((string) ($stat['name'] ?? ''));
                $output = @fopen($target, 'xb');
                if (!is_resource($input) || !is_resource($output)) {
                    if (is_resource($input)) fclose($input);
                    if (is_resource($output)) fclose($output);
                    throw new RuntimeException('Não foi possível extrair uma entrada do ZIP.');
                }
                $written = stream_copy_to_stream($input, $output, self::MAX_FILE_BYTES + 1);
                fclose($input);
                fclose($output);
                if (!is_int($written) || $written !== $size) throw new RuntimeException('Uma entrada ZIP terminou incompleta.');
            }
            return $destination;
        } catch (Throwable $error) {
            $this->remove_tree($destination);
            return new WP_Error('kodety_extensions_archive_rejected', $error->getMessage());
        } finally {
            $zip->close();
        }
    }

    private function normalize_archive_entry(string $name): string {
        $name = str_replace('\\', '/', $name);
        if (
            $name === ''
            || str_contains($name, "\0")
            || str_starts_with($name, '/')
            || preg_match('/^[A-Za-z]:\//', $name)
            || strlen($name) > 512
        ) {
            throw new RuntimeException('Caminho absoluto ou inválido no ZIP.');
        }
        $parts = explode('/', $name);
        foreach ($parts as $part) {
            if ($part === '..') throw new RuntimeException('Travessia de diretório detectada no ZIP.');
        }
        return ltrim(preg_replace('~/+~', '/', $name) ?: '', './');
    }

    private function zip_entry_is_link(ZipArchive $zip, int $index): bool {
        $opsys = 0;
        $attributes = 0;
        if (!$zip->getExternalAttributesIndex($index, $opsys, $attributes)) return false;
        if ($opsys !== ZipArchive::OPSYS_UNIX) return false;
        return (($attributes >> 16) & 0xF000) === 0xA000;
    }

    private function manifest_root(string $extracted, string $filename): ?string {
        $matches = [];
        if (is_file($extracted . '/' . $filename)) $matches[] = $extracted;
        $children = scandir($extracted);
        foreach (is_array($children) ? $children : [] as $child) {
            if ($child === '.' || $child === '..' || str_starts_with($child, '.')) continue;
            $directory = $extracted . '/' . $child;
            if (is_dir($directory) && is_file($directory . '/' . $filename)) $matches[] = $directory;
        }
        $matches = array_values(array_unique($matches));
        if (count($matches) > 1) throw new RuntimeException('O pacote contém mais de um manifesto principal.');
        return $matches[0] ?? null;
    }

    /** @return array<string,mixed>|WP_Error */
    private function read_json_manifest(string $path): array|WP_Error {
        if (!is_file($path) || (int) (filesize($path) ?: 0) > 256 * 1024) {
            return new WP_Error('kodety_extension_manifest_size', 'O manifesto está ausente ou é grande demais.');
        }
        try {
            $decoded = json_decode((string) file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            return new WP_Error('kodety_extension_manifest_json', 'O manifesto não contém JSON válido.');
        }
        return is_array($decoded)
            ? $decoded
            : new WP_Error('kodety_extension_manifest_shape', 'O manifesto deve ser um objeto JSON.');
    }

    /**
     * @return list<string>|WP_Error
     */
    private function normalize_bundle_manifest(array $manifest, string $root): array|WP_Error {
        $schema = (int) ($manifest['schemaVersion'] ?? $manifest['schema'] ?? 0);
        if ($schema !== 1 || (string) ($manifest['type'] ?? 'bundle') !== 'bundle') {
            return new WP_Error('kodety_bundle_schema', 'O bundle usa um formato não suportado.');
        }
        $packages = is_array($manifest['packages'] ?? null) ? $manifest['packages'] : [];
        if (!$packages || count($packages) > self::MAX_BUNDLE_PACKAGES) {
            return new WP_Error('kodety_bundle_packages', 'O bundle deve listar de 1 a 50 pacotes.');
        }
        $clean = [];
        foreach ($packages as $package) {
            $relative = $this->normalize_manifest_path((string) $package, 'zip');
            if (is_wp_error($relative)) return $relative;
            $absolute = realpath($root . '/' . $relative);
            $root_real = realpath($root);
            if (
                !$absolute
                || !$root_real
                || !str_starts_with($this->normalize_path($absolute), trailingslashit($this->normalize_path($root_real)))
                || !is_file($absolute)
            ) {
                return new WP_Error('kodety_bundle_package_missing', 'Um pacote listado no bundle não existe: ' . $relative);
            }
            $clean[] = $absolute;
        }
        return array_values(array_unique($clean));
    }

    /** @return array<string,mixed>|WP_Error */
    private function prepare_extension_archive(string $archive_path): array|WP_Error {
        $error = $this->archive_file_error($archive_path);
        if ($error) return $error;
        $extracted = $this->extract_archive($archive_path, false);
        if (is_wp_error($extracted)) return $extracted;
        try {
            $root = $this->manifest_root($extracted, self::MANIFEST_FILE);
            if ($root === null) {
                return new WP_Error('kodety_extensions_manifest_missing', 'Um ZIP do bundle não contém kodety-extension.json.');
            }
            $prepared = $this->prepare_extracted_extension($root, $archive_path);
            if (is_wp_error($prepared)) return $prepared;
            $prepared['cleanupRoot'] = $extracted;
            return $prepared;
        } catch (Throwable $error) {
            return new WP_Error('kodety_extensions_manifest_invalid', $error->getMessage());
        } finally {
            // Successful prepared entries own this directory until commit.
            if (!isset($prepared) || is_wp_error($prepared)) $this->remove_tree($extracted);
        }
    }

    /** @return array<string,mixed>|WP_Error */
    private function prepare_extracted_extension(string $root, string $archive_path): array|WP_Error {
        $manifest = $this->read_json_manifest($root . '/' . self::MANIFEST_FILE);
        if (is_wp_error($manifest)) return $manifest;
        $normalized = $this->normalize_extension_manifest($manifest, $root);
        if (is_wp_error($normalized)) return $normalized;
        return [
            'manifest' => $normalized,
            'sourceRoot' => $root,
            'cleanupRoot' => '',
            'checksum' => hash_file('sha256', $archive_path) ?: '',
        ];
    }

    /** @return array<string,mixed>|WP_Error */
    private function normalize_extension_manifest(array $manifest, string $root): array|WP_Error {
        $schema = (int) ($manifest['schemaVersion'] ?? $manifest['schema'] ?? 0);
        if ($schema !== 1 || (string) ($manifest['type'] ?? 'extension') !== 'extension') {
            return new WP_Error('kodety_extension_schema', 'A extensão usa um formato não suportado.');
        }
        $slug = $this->sanitize_slug((string) ($manifest['slug'] ?? ''));
        if ($slug === '') return new WP_Error('kodety_extension_slug', 'O slug da extensão é inválido.');
        $bundled = $this->bundled_catalog();
        if (isset($bundled[$slug])) {
            return new WP_Error('kodety_extension_reserved_slug', 'Este slug pertence a uma extensão incluída no Onun Kodety.');
        }

        $name = sanitize_text_field((string) ($manifest['name'] ?? ''));
        $description = sanitize_text_field((string) ($manifest['description'] ?? ''));
        $version = trim((string) ($manifest['version'] ?? ''));
        if ($name === '' || strlen($name) > 120) {
            return new WP_Error('kodety_extension_name', 'O nome da extensão é obrigatório e deve ter até 120 caracteres.');
        }
        if ($description === '' || strlen($description) > 500) {
            return new WP_Error('kodety_extension_description', 'A descrição é obrigatória e deve ter até 500 caracteres.');
        }
        if (!preg_match('/^[0-9][0-9A-Za-z.+-]{0,63}$/', $version)) {
            return new WP_Error('kodety_extension_version', 'A versão da extensão é inválida.');
        }
        $entry = $this->normalize_manifest_path((string) ($manifest['entry'] ?? ''), 'php');
        if (is_wp_error($entry)) return $entry;
        if (!is_file($root . '/' . $entry)) {
            return new WP_Error('kodety_extension_entry_missing', 'O entrypoint definido no manifesto não existe.');
        }

        $requires = is_array($manifest['requires'] ?? null) ? $manifest['requires'] : [];
        $php_min = $this->minimum_version((string) ($requires['php'] ?? '8.0'));
        $kodety_min = $this->minimum_version((string) ($requires['kodety'] ?? '0.0.0'));
        $extension_api_min = $this->minimum_version((string) ($requires['extensionApi'] ?? '0.0.0'));
        if ($php_min === '' || version_compare(PHP_VERSION, $php_min, '<')) {
            return new WP_Error('kodety_extension_php_version', 'A extensão requer PHP ' . ($php_min ?: 'mais recente') . ' ou superior.');
        }
        $current_kodety = defined('KODETY_VERSION') ? (string) KODETY_VERSION : '0.0.0';
        if ($kodety_min === '' || version_compare($current_kodety, $kodety_min, '<')) {
            return new WP_Error('kodety_extension_kodety_version', 'A extensão requer Onun Kodety ' . ($kodety_min ?: 'mais recente') . ' ou superior.');
        }
        $current_extension_api = class_exists('Kodety_Extension_API')
            ? Kodety_Extension_API::VERSION
            : '0.0.0';
        if (
            $extension_api_min === ''
            || version_compare($current_extension_api, $extension_api_min, '<')
        ) {
            return new WP_Error(
                'kodety_extension_api_version',
                'A extensão requer a Extension API '
                    . ($extension_api_min ?: 'mais recente')
                    . ' ou superior.'
            );
        }

        $permissions = [];
        $raw_permissions = $manifest['permissions'] ?? [];
        if (!is_array($raw_permissions)) {
            return new WP_Error(
                'kodety_extension_permissions',
                'As permissões da extensão devem ser uma lista.'
            );
        }
        $known_permissions = class_exists('Kodety_Extension_API')
            ? Kodety_Extension_API::known_permissions()
            : [];
        foreach ($raw_permissions as $permission) {
            $permission = is_string($permission) ? strtolower(trim($permission)) : '';
            if ($permission === '' || !in_array($permission, $known_permissions, true)) {
                return new WP_Error(
                    'kodety_extension_permission_unknown',
                    'O manifesto solicita uma permissão pública desconhecida: '
                        . ($permission ?: '(inválida)')
                        . '.'
                );
            }
            $permissions[] = $permission;
        }

        $dependencies = [];
        foreach (is_array($manifest['dependencies'] ?? null) ? $manifest['dependencies'] : [] as $dependency) {
            $dependency = $this->sanitize_slug((string) $dependency);
            if ($dependency === '' || $dependency === $slug) {
                return new WP_Error('kodety_extension_dependencies', 'A lista de dependências contém um slug inválido.');
            }
            $dependencies[] = $dependency;
        }

        $author = is_array($manifest['author'] ?? null) ? $manifest['author'] : [];
        $normalized = [
            'schemaVersion' => 1,
            'type' => 'extension',
            'slug' => $slug,
            'name' => $name,
            'description' => $description,
            'version' => $version,
            'entry' => $entry,
            'icon' => sanitize_key((string) ($manifest['icon'] ?? 'plugins')) ?: 'plugins',
            'requires' => [
                'php' => $php_min,
                'kodety' => $kodety_min,
                'extensionApi' => $extension_api_min,
            ],
            'dependencies' => array_values(array_unique($dependencies)),
            'author' => [
                'name' => sanitize_text_field((string) ($author['name'] ?? '')),
                'url' => esc_url_raw((string) ($author['url'] ?? '')),
            ],
            'homepage' => esc_url_raw((string) ($manifest['homepage'] ?? '')),
            'permissions' => array_values(array_unique($permissions)),
            'capabilities' => array_values(array_unique(array_filter(array_map(
                static fn(mixed $value): string => sanitize_key((string) $value),
                is_array($manifest['capabilities'] ?? null) ? $manifest['capabilities'] : []
            )))),
        ];
        $filtered = apply_filters('kodety_extension_manifest', $normalized, $manifest, $root, $this);
        if (!is_array($filtered)) return $normalized;
        // Filters may enrich presentation metadata, but they cannot bypass the
        // paths, compatibility and identity checks already completed above.
        foreach (['name', 'description', 'icon', 'author', 'homepage'] as $field) {
            if (array_key_exists($field, $filtered)) $normalized[$field] = $filtered[$field];
        }
        $normalized['name'] = sanitize_text_field((string) $normalized['name']);
        $normalized['description'] = sanitize_text_field((string) $normalized['description']);
        $normalized['icon'] = sanitize_key((string) $normalized['icon']) ?: 'plugins';
        $normalized['homepage'] = esc_url_raw((string) $normalized['homepage']);
        $normalized['author'] = is_array($normalized['author']) ? [
            'name' => sanitize_text_field((string) ($normalized['author']['name'] ?? '')),
            'url' => esc_url_raw((string) ($normalized['author']['url'] ?? '')),
        ] : ['name' => '', 'url' => ''];
        $normalized['capabilities'] = array_values(array_unique(array_filter(array_map(
            static fn(mixed $value): string => sanitize_key((string) $value),
            is_array($normalized['capabilities']) ? $normalized['capabilities'] : []
        ))));
        return $normalized;
    }

    /** @return string|WP_Error */
    private function normalize_manifest_path(string $path, string $required_extension): string|WP_Error {
        $path = str_replace('\\', '/', trim($path));
        if (
            $path === ''
            || str_starts_with($path, '/')
            || preg_match('/^[A-Za-z]:\//', $path)
            || str_contains($path, "\0")
            || str_contains('/' . $path . '/', '/../')
            || strlen($path) > 255
            || strtolower(pathinfo($path, PATHINFO_EXTENSION)) !== $required_extension
        ) {
            return new WP_Error('kodety_extension_manifest_path', 'O manifesto contém um caminho de arquivo inválido.');
        }
        return $path;
    }

    private function minimum_version(string $constraint): string {
        $constraint = trim($constraint);
        if (str_starts_with($constraint, '>=')) $constraint = trim(substr($constraint, 2));
        return preg_match('/^[0-9]+(?:\.[0-9]+){0,3}$/', $constraint) ? $constraint : '';
    }

    /** @return list<string> */
    private function active_dependents(string $slug): array {
        $slug = $this->sanitize_slug($slug);
        if ($slug === '') return [];
        $dependents = [];
        foreach ($this->installed() as $candidate_slug => $extension) {
            $candidate_slug = $this->sanitize_slug((string) $candidate_slug);
            if (
                $candidate_slug === ''
                || $candidate_slug === $slug
                || !$this->is_active($candidate_slug)
            ) {
                continue;
            }
            $dependencies = is_array($extension['dependencies'] ?? null)
                ? $extension['dependencies']
                : [];
            foreach ($dependencies as $dependency) {
                if ($this->sanitize_slug((string) $dependency) !== $slug) continue;
                $dependents[] = $candidate_slug;
                break;
            }
        }
        sort($dependents, SORT_STRING);
        return array_values(array_unique($dependents));
    }

    /**
     * Inner packages share the same global extraction budget. Without this
     * second pass, a small outer bundle could expand each nested ZIP up to the
     * per-archive limit and exhaust disk space before the atomic commit.
     *
     * @param list<array<string,mixed>> $prepared
     */
    private function prepared_limits_error(array $prepared): ?WP_Error {
        $files = 0;
        $bytes = 0;
        $seen = [];
        foreach ($prepared as $candidate) {
            $directory = (string) (
                $candidate['cleanupRoot']
                ?? $candidate['sourceRoot']
                ?? ''
            );
            $real = $directory !== '' ? realpath($directory) : false;
            if (!$real || isset($seen[$real])) continue;
            $seen[$real] = true;
            $iterator = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($real, FilesystemIterator::SKIP_DOTS)
            );
            foreach ($iterator as $item) {
                if ($item->isLink() || !$item->isFile()) continue;
                $files += 1;
                $bytes += max(0, (int) $item->getSize());
                if ($files > self::MAX_FILES || $bytes > self::MAX_UNCOMPRESSED_BYTES) {
                    return new WP_Error(
                        'kodety_extensions_bundle_limits',
                        'O conjunto de extensões ultrapassa 2.000 arquivos ou 256 MB descompactados.'
                    );
                }
            }
        }
        return null;
    }

    /**
     * Atomically move validated packages into their final directories and
     * persist the whole registry in a single option write.
     *
     * @param list<array<string,mixed>> $prepared
     * @return list<array<string,mixed>>|WP_Error
     */
    private function commit_prepared(array $prepared): array|WP_Error {
        $registry = $this->registry();
        $next = $registry;
        $moves = [];
        $now = gmdate('c');

        foreach ($prepared as $candidate) {
            $manifest = is_array($candidate['manifest'] ?? null) ? $candidate['manifest'] : [];
            $slug = (string) ($manifest['slug'] ?? '');
            $source = (string) ($candidate['sourceRoot'] ?? '');
            if ($slug === '' || !is_dir($source)) {
                return new WP_Error('kodety_extension_stage_invalid', 'Uma extensão validada perdeu seus arquivos temporários.');
            }
            $destination = $this->extension_directory($slug);
            $backup = is_dir($destination)
                ? $this->storage_dir . '/.backup-' . $slug . '-' . $this->random_suffix()
                : '';
            $previous_record = is_array($registry[$slug] ?? null) ? $registry[$slug] : [];
            $previous_manifest = is_array($previous_record['manifest'] ?? null)
                ? $previous_record['manifest']
                : [];
            $previous_version = (string) ($previous_manifest['version'] ?? '');
            $next_version = (string) ($manifest['version'] ?? '');
            $previous_checksum = (string) ($previous_record['checksum'] ?? '');
            $next_checksum = (string) ($candidate['checksum'] ?? '');
            $checksum_changed = $next_checksum !== ''
                && ($previous_checksum === '' || !hash_equals($previous_checksum, $next_checksum));
            if (!empty($previous_record['active'])) {
                foreach ((array) ($manifest['dependencies'] ?? []) as $dependency) {
                    $dependency = $this->sanitize_slug((string) $dependency);
                    if ($dependency !== '' && $this->is_active($dependency)) continue;
                    return new WP_Error(
                        'kodety_extension_dependency_inactive',
                        'A atualização ativa de '
                            . $slug
                            . ' requer primeiro a dependência '
                            . ($dependency ?: '(inválida)')
                            . '.'
                    );
                }
            }
            $pending_activation = !empty($previous_record['pendingActivation'])
                || (
                    !empty($previous_record['active'])
                    && (
                        $checksum_changed
                        || (
                            $previous_version !== ''
                            && $next_version !== ''
                            && !hash_equals($previous_version, $next_version)
                        )
                    )
                );
            $moves[] = compact('slug', 'source', 'destination', 'backup');
            $next[$slug] = [
                'manifest' => $manifest,
                'active' => !empty($previous_record['active']),
                'pendingActivation' => $pending_activation,
                'bundled' => false,
                'checksum' => (string) ($candidate['checksum'] ?? ''),
                'installedAt' => (string) ($previous_record['installedAt'] ?? $now),
                'updatedAt' => $now,
                'lastError' => '',
            ];
        }

        do_action('kodety_extension_before_install', array_column($prepared, 'manifest'), $this);
        $completed = [];
        try {
            foreach ($moves as $move) {
                if ($move['backup'] !== '' && !@rename($move['destination'], $move['backup'])) {
                    throw new RuntimeException('Não foi possível preparar a atualização de ' . $move['slug'] . '.');
                }
                if (!@rename($move['source'], $move['destination'])) {
                    if ($move['backup'] !== '') @rename($move['backup'], $move['destination']);
                    throw new RuntimeException('Não foi possível instalar os arquivos de ' . $move['slug'] . '.');
                }
                $completed[] = $move;
            }
            if (!$this->write_registry($next)) {
                throw new RuntimeException('Não foi possível confirmar o registro das extensões no WordPress.');
            }
        } catch (Throwable $error) {
            foreach (array_reverse($completed) as $move) {
                $this->remove_tree($move['destination']);
                if ($move['backup'] !== '') @rename($move['backup'], $move['destination']);
            }
            $this->write_registry($registry);
            return new WP_Error('kodety_extensions_install_failed', $error->getMessage());
        }

        foreach ($moves as $move) {
            if ($move['backup'] !== '') $this->remove_tree($move['backup']);
        }
        $installed = [];
        foreach ($prepared as $candidate) {
            $manifest = (array) $candidate['manifest'];
            $slug = (string) $manifest['slug'];
            $record = array_merge($manifest, [
                'installed' => true,
                'active' => !empty($next[$slug]['active']),
                'bundled' => false,
                'status' => !empty($next[$slug]['active']) ? 'active' : 'inactive',
            ]);
            $installed[] = $record;
            try {
                do_action('kodety_extension_after_install', $slug, $record, $this);
            } catch (Throwable $error) {
                // Files and registry are already committed. A post-commit
                // observer cannot turn a successful atomic install into a
                // misleading failure response.
                error_log(
                    '[Onun Kodety] Falha no hook pós-instalação de '
                    . $slug
                    . ': '
                    . $error->getMessage()
                );
            }
        }
        return $installed;
    }

    private function extension_directory(string $slug): string {
        return $this->storage_dir . '/' . $this->sanitize_slug($slug);
    }

    private function sanitize_slug(string $slug): string {
        $slug = strtolower(trim($slug));
        return preg_match('/^[a-z0-9][a-z0-9-]{2,63}$/', $slug) ? $slug : '';
    }

    private function normalize_path(string $path): string {
        return function_exists('wp_normalize_path') ? wp_normalize_path($path) : str_replace('\\', '/', $path);
    }

    private function random_suffix(): string {
        try {
            return bin2hex(random_bytes(8));
        } catch (Throwable) {
            return str_replace('.', '', uniqid('', true));
        }
    }

    private function remove_tree(string $directory): void {
        if ($directory === '' || !is_dir($directory)) return;
        $root = realpath($this->storage_dir);
        $target = realpath($directory);
        if (
            !$root
            || !$target
            || $target === $root
            || !str_starts_with($this->normalize_path($target), trailingslashit($this->normalize_path($root)))
        ) {
            return;
        }
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($target, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($iterator as $item) {
            $path = $item->getPathname();
            if ($item->isLink() || $item->isFile()) @unlink($path);
            elseif ($item->isDir()) @rmdir($path);
        }
        @rmdir($target);
    }

    public function admin_install(): void {
        if (!current_user_can('manage_options') || !current_user_can('install_plugins')) {
            wp_die('Sem permissão para instalar extensões.', '', ['response' => 403]);
        }
        check_admin_referer('kodety_install_extension', 'kodety_extension_nonce');
        $file = isset($_FILES['kodety_extension_zip']) && is_array($_FILES['kodety_extension_zip'])
            ? $_FILES['kodety_extension_zip']
            : [];
        if ((int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            $this->redirect_notice('error', 'O upload do ZIP não foi concluído.');
        }
        $name = sanitize_file_name((string) ($file['name'] ?? ''));
        $temporary = (string) ($file['tmp_name'] ?? '');
        if (!str_ends_with(strtolower($name), '.zip')) {
            $this->redirect_notice('error', 'Selecione um arquivo ZIP de extensão ou bundle.');
        }
        $result = $this->install_zip($temporary);
        if (is_wp_error($result)) $this->redirect_notice('error', $result->get_error_message());
        $count = count($result['installed']);
        $label = $count === 1 ? 'Extensão instalada' : $count . ' extensões instaladas';
        $this->redirect_notice('success', $label . '. Ative os módulos que deseja usar.');
    }

    public function admin_activate(): void {
        $this->assert_manage_request();
        $result = $this->activate_extension($this->posted_slug());
        if (is_wp_error($result)) $this->redirect_notice('error', $result->get_error_message());
        $this->redirect_notice('success', 'Extensão ativada.');
    }

    public function admin_deactivate(): void {
        $this->assert_manage_request();
        $result = $this->deactivate_extension($this->posted_slug());
        if (is_wp_error($result)) $this->redirect_notice('error', $result->get_error_message());
        $this->redirect_notice('success', 'Extensão desativada. As configurações foram preservadas.');
    }

    public function admin_uninstall(): void {
        if (!current_user_can('manage_options') || !current_user_can('install_plugins')) {
            wp_die('Sem permissão para remover extensões.', '', ['response' => 403]);
        }
        check_admin_referer('kodety_manage_extension', 'kodety_extension_nonce');
        $delete_settings = isset($_POST['kodety_delete_extension_settings'])
            && (string) wp_unslash($_POST['kodety_delete_extension_settings']) === '1';
        $result = $this->uninstall($this->posted_slug(), $delete_settings);
        if (is_wp_error($result)) $this->redirect_notice('error', $result->get_error_message());
        $this->redirect_notice('success', $delete_settings
            ? 'Extensão e configurações removidas.'
            : 'Extensão removida. As configurações foram preservadas.');
    }

    private function assert_manage_request(): void {
        if (!current_user_can('manage_options') || !current_user_can('activate_plugins')) {
            wp_die('Sem permissão para gerenciar extensões.', '', ['response' => 403]);
        }
        check_admin_referer('kodety_manage_extension', 'kodety_extension_nonce');
    }

    private function posted_slug(): string {
        $slug = isset($_POST['kodety_extension_slug']) && is_string($_POST['kodety_extension_slug'])
            ? $this->sanitize_slug(wp_unslash($_POST['kodety_extension_slug']))
            : '';
        if ($slug === '') wp_die('Extensão inválida.', '', ['response' => 400]);
        return $slug;
    }

    private function redirect_notice(string $type, string $message): void {
        $url = add_query_arg([
            'page' => 'kodety',
            'kodety_notice' => rawurlencode($message),
            'kodety_type' => $type === 'success' ? 'success' : 'error',
        ], admin_url('admin.php'));
        wp_safe_redirect($url . '#kodety-extensions');
        exit;
    }
}
