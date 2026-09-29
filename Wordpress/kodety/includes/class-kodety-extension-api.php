<?php

defined('ABSPATH') || exit;

/**
 * Public, versioned API for installed Onun Kodety extensions.
 *
 * This file is the supported boundary between extension code and Onun Kodety. The
 * services intentionally expose small WordPress-backed primitives instead of
 * internal Builder or CMS objects.
 */
final class Kodety_Extension_API {
    public const VERSION = '1.0.0';

    /** @var list<string> */
    private const PERMISSIONS = [
        'hooks.listen',
        'hooks.emit',
        'events.listen',
        'events.emit',
        'storage.read',
        'storage.write',
        'routes.register',
        'admin.register',
        'media.read',
        'media.write',
        'auth.read',
        'ui.render',
        'frontend.read',
        'frontend.register',
        'blocks.register',
    ];

    private static ?self $instance = null;
    /** @var array<string,Kodety_Extension_Context> */
    private array $contexts = [];
    /** @var list<Kodety_Extension_Context> */
    private array $stack = [];
    /** @var array<string,array<string,mixed>> */
    private array $block_types = [];

    private function __construct() {}

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    /** @return list<string> */
    public static function known_permissions(): array {
        return self::PERMISSIONS;
    }

    public static function supports(string $minimum): bool {
        $minimum = trim($minimum);
        if (str_starts_with($minimum, '>=')) $minimum = trim(substr($minimum, 2));
        return preg_match('/^[0-9]+(?:\.[0-9]+){0,3}$/', $minimum) === 1
            && version_compare(self::VERSION, $minimum, '>=');
    }

    /**
     * Opens the entrypoint-scoped context. Manager integration only.
     *
     * Extensions obtain this object through kodety_extension() while their
     * entrypoint is being evaluated and then capture it in their callbacks.
     *
     * @internal
     * @param array<string,mixed> $manifest
     */
    public function enter(string $slug, array $manifest, string $root): Kodety_Extension_Context {
        $manifest_slug = (string) ($manifest['slug'] ?? '');
        if ($slug === '' || $manifest_slug !== $slug) {
            throw new InvalidArgumentException('O contexto da extensão não corresponde ao manifesto.');
        }
        $root = realpath($root) ?: '';
        if ($root === '' || !is_dir($root)) {
            throw new InvalidArgumentException('A raiz instalada da extensão não está disponível.');
        }

        $context = $this->contexts[$slug] ?? null;
        if (!$context || $context->manifest() !== $manifest || $context->root() !== $root) {
            $context = new Kodety_Extension_Context($this, $manifest, $root);
            $this->contexts[$slug] = $context;
        }
        $this->stack[] = $context;
        try {
            do_action('kodety/extension-api/context/opened', $context);
        } catch (Throwable $error) {
            array_pop($this->stack);
            throw $error;
        }
        return $context;
    }

    /** @internal */
    public function leave(string $slug): void {
        $context = array_pop($this->stack);
        if (!$context) return;
        if ($context->slug() !== $slug) {
            $this->stack = [];
            throw new RuntimeException('A pilha de contextos de extensões ficou inconsistente.');
        }
        do_action('kodety/extension-api/context/closed', $context);
    }

    public function current(): ?Kodety_Extension_Context {
        $context = end($this->stack);
        return $context instanceof Kodety_Extension_Context ? $context : null;
    }

    /** @internal */
    public function invoke(Kodety_Extension_Context $context, callable $callback, array $arguments = []): mixed {
        $this->stack[] = $context;
        try {
            return $callback(...$arguments);
        } finally {
            array_pop($this->stack);
        }
    }

    /** @internal @param array<string,mixed> $definition */
    public function register_block_type(
        Kodety_Extension_Context $context,
        string $name,
        array $definition
    ): string {
        $canonical = $context->slug() . '/' . $name;
        if (isset($this->block_types[$canonical])) {
            throw new LogicException('O block type já foi registrado: ' . $canonical);
        }
        $definition['name'] = $canonical;
        $definition['extension'] = $context->slug();
        $this->block_types[$canonical] = $definition;
        try {
            do_action('kodety/extension-api/block-type/registered', $canonical, $definition, $context);
        } catch (Throwable $error) {
            unset($this->block_types[$canonical]);
            throw $error;
        }
        return $canonical;
    }

    /** @return array<string,array<string,mixed>> */
    public function block_types(): array {
        $types = apply_filters('kodety/extension-api/block-types', $this->block_types);
        return is_array($types) ? $types : $this->block_types;
    }
}

class Kodety_Extension_API_Exception extends RuntimeException {}
class Kodety_Extension_Permission_Exception extends Kodety_Extension_API_Exception {}
class Kodety_Extension_Capability_Exception extends Kodety_Extension_API_Exception {}

final class Kodety_Extension_Context {
    private Kodety_Extension_API $api;
    /** @var array<string,mixed> */
    private array $manifest;
    private string $root;
    /** @var array<string,bool> */
    private array $permissions = [];
    /** @var array<string,bool> */
    private array $capabilities = [];
    /** @var array<string,object> */
    private array $services = [];

    /** @internal @param array<string,mixed> $manifest */
    public function __construct(Kodety_Extension_API $api, array $manifest, string $root) {
        $this->api = $api;
        $this->manifest = $manifest;
        $this->root = $root;
        foreach ((array) ($manifest['permissions'] ?? []) as $permission) {
            if (is_string($permission) && $permission !== '') $this->permissions[$permission] = true;
        }
        foreach ((array) ($manifest['capabilities'] ?? []) as $capability) {
            if (is_string($capability) && $capability !== '') $this->capabilities[$capability] = true;
        }
    }

    public function api_version(): string {
        return Kodety_Extension_API::VERSION;
    }

    public function slug(): string {
        return (string) $this->manifest['slug'];
    }

    /** @return array<string,mixed> */
    public function manifest(): array {
        return $this->manifest;
    }

    /** @internal */
    public function root(): string {
        return $this->root;
    }

    public function has_permission(string $permission): bool {
        return !empty($this->permissions[$permission]);
    }

    public function require_permission(string $permission): void {
        if ($this->has_permission($permission)) return;
        throw new Kodety_Extension_Permission_Exception(
            sprintf('A extensão %s não declarou a permissão %s.', $this->slug(), $permission)
        );
    }

    public function declares_capability(string $capability): bool {
        return !empty($this->capabilities[$capability]);
    }

    public function require_declared_capability(string $capability): void {
        if ($capability !== '' && $this->declares_capability($capability)) return;
        throw new Kodety_Extension_Capability_Exception(
            sprintf('A extensão %s não declarou a capability WordPress %s.', $this->slug(), $capability ?: '(vazia)')
        );
    }

    /** @internal */
    public function invoke(callable $callback, array $arguments = []): mixed {
        return $this->api->invoke($this, $callback, $arguments);
    }

    /** @internal */
    public function report_callback_failure(string $surface, Throwable $error): void {
        $surface = strtolower(trim($surface));
        if (!preg_match('/^[a-z][a-z0-9._-]{0,79}$/', $surface)) $surface = 'callback';
        $message = str_replace(["\r", "\n"], ['\\r', '\\n'], $error->getMessage());
        $message = substr($message, 0, 2000);
        error_log(
            '[Onun Kodety][Extension API]['
            . $this->slug()
            . ']['
            . $surface
            . '] '
            . get_class($error)
            . ': '
            . $message
        );
    }

    /** @internal */
    public function rest_callback_failure(string $surface, Throwable $error): WP_Error {
        $this->report_callback_failure($surface, $error);
        return new WP_Error(
            'kodety_extension_callback_failed',
            'A extensão não conseguiu processar esta solicitação.',
            ['status' => 500]
        );
    }

    public function hooks(): Kodety_Extension_Hooks {
        return $this->service('hooks', Kodety_Extension_Hooks::class);
    }

    public function events(): Kodety_Extension_Events {
        return $this->service('events', Kodety_Extension_Events::class);
    }

    public function storage(): Kodety_Extension_Storage {
        return $this->service('storage', Kodety_Extension_Storage::class);
    }

    public function routes(): Kodety_Extension_Routes {
        return $this->service('routes', Kodety_Extension_Routes::class);
    }

    public function admin(): Kodety_Extension_Admin {
        return $this->service('admin', Kodety_Extension_Admin::class);
    }

    public function media(): Kodety_Extension_Media {
        return $this->service('media', Kodety_Extension_Media::class);
    }

    public function auth(): Kodety_Extension_Auth {
        return $this->service('auth', Kodety_Extension_Auth::class);
    }

    public function ui(): Kodety_Extension_UI {
        return $this->service('ui', Kodety_Extension_UI::class);
    }

    public function frontend(): Kodety_Extension_Frontend {
        return $this->service('frontend', Kodety_Extension_Frontend::class);
    }

    public function blocks(): Kodety_Extension_Blocks {
        return $this->service('blocks', Kodety_Extension_Blocks::class);
    }

    /** @template T of object @param class-string<T> $class @return T */
    private function service(string $key, string $class): object {
        if (!isset($this->services[$key])) $this->services[$key] = new $class($this);
        return $this->services[$key];
    }
}

abstract class Kodety_Extension_Service {
    protected Kodety_Extension_Context $context;

    public function __construct(Kodety_Extension_Context $context) {
        $this->context = $context;
    }

    protected function name(string $name): string {
        $name = strtolower(trim($name));
        if (
            $name === ''
            || strlen($name) > 100
            || !preg_match('~^[a-z][a-z0-9._/-]*$~', $name)
            || str_contains('/' . $name . '/', '/../')
            || str_contains($name, '//')
        ) {
            throw new InvalidArgumentException('Nome público inválido para a API de extensões.');
        }
        return $name;
    }
}

final class Kodety_Extension_Hooks extends Kodety_Extension_Service {
    public function hook_name(string $name): string {
        return 'kodety/extension/' . $this->context->slug() . '/hook/' . $this->name($name);
    }

    public function on(string $name, callable $callback, int $priority = 10, int $accepted_args = 1): string {
        $this->context->require_permission('hooks.listen');
        $hook = $this->hook_name($name);
        $context = $this->context;
        add_action($hook, static function (mixed ...$arguments) use ($context, $callback): mixed {
            try {
                return $context->invoke($callback, $arguments);
            } catch (Throwable $error) {
                $context->report_callback_failure('hook.action', $error);
                return null;
            }
        }, $priority, max(0, $accepted_args));
        return $hook;
    }

    public function emit(string $name, mixed ...$arguments): void {
        $this->context->require_permission('hooks.emit');
        try {
            do_action($this->hook_name($name), ...$arguments);
        } catch (Throwable $error) {
            $this->context->report_callback_failure('hook.emit', $error);
        }
    }

    public function filter(
        string $name,
        callable $callback,
        int $priority = 10,
        int $accepted_args = 1
    ): string {
        $this->context->require_permission('hooks.listen');
        $hook = $this->hook_name($name);
        $context = $this->context;
        add_filter($hook, static function (mixed ...$arguments) use ($context, $callback): mixed {
            $fallback = $arguments[0] ?? null;
            try {
                return $context->invoke($callback, $arguments);
            } catch (Throwable $error) {
                $context->report_callback_failure('hook.filter', $error);
                return $fallback;
            }
        }, $priority, max(1, $accepted_args));
        return $hook;
    }

    public function apply(string $name, mixed $value, mixed ...$arguments): mixed {
        $this->context->require_permission('hooks.emit');
        try {
            return apply_filters($this->hook_name($name), $value, ...$arguments);
        } catch (Throwable $error) {
            $this->context->report_callback_failure('hook.apply', $error);
            return $value;
        }
    }
}

final class Kodety_Extension_Events extends Kodety_Extension_Service {
    public function event_name(string $name): string {
        return 'kodety/extension/' . $this->context->slug() . '/event/' . $this->name($name);
    }

    public function listen(string $name, callable $listener, int $priority = 10): string {
        $this->context->require_permission('events.listen');
        $event = $this->event_name($name);
        $context = $this->context;
        add_action($event, static function (mixed $payload = null) use ($context, $listener): mixed {
            try {
                return $context->invoke($listener, [$payload, $context]);
            } catch (Throwable $error) {
                $context->report_callback_failure('event.listener', $error);
                return null;
            }
        }, $priority, 1);
        return $event;
    }

    public function dispatch(string $name, mixed $payload = null): void {
        $this->context->require_permission('events.emit');
        try {
            do_action($this->event_name($name), $payload);
        } catch (Throwable $error) {
            $this->context->report_callback_failure('event.dispatch', $error);
        }
    }
}

final class Kodety_Extension_Storage extends Kodety_Extension_Service {
    private function option_name(): string {
        return 'kodety_extension_storage_v1_' . $this->context->slug();
    }

    private function key(string $key): string {
        $key = trim($key);
        if ($key === '' || strlen($key) > 120 || !preg_match('/^[A-Za-z0-9_.:-]+$/', $key)) {
            throw new InvalidArgumentException('A chave de storage da extensão é inválida.');
        }
        return $key;
    }

    /** @return array<string,mixed> */
    public function all(): array {
        $this->context->require_permission('storage.read');
        $value = get_option($this->option_name(), []);
        return is_array($value) ? $value : [];
    }

    public function get(string $key, mixed $default = null): mixed {
        $values = $this->all();
        $key = $this->key($key);
        return array_key_exists($key, $values) ? $values[$key] : $default;
    }

    public function has(string $key): bool {
        $values = $this->all();
        return array_key_exists($this->key($key), $values);
    }

    public function set(string $key, mixed $value): bool {
        $this->context->require_permission('storage.write');
        $this->assert_value($value);
        $key = $this->key($key);
        $raw = get_option($this->option_name(), []);
        $values = is_array($raw) ? $raw : [];
        if (array_key_exists($key, $values) && $values[$key] === $value) return true;
        $values[$key] = $value;
        return update_option($this->option_name(), $values, false);
    }

    public function delete(string $key): bool {
        $this->context->require_permission('storage.write');
        $key = $this->key($key);
        $raw = get_option($this->option_name(), []);
        $values = is_array($raw) ? $raw : [];
        if (!array_key_exists($key, $values)) return true;
        unset($values[$key]);
        return update_option($this->option_name(), $values, false);
    }

    public function clear(): bool {
        $this->context->require_permission('storage.write');
        $raw = get_option($this->option_name(), []);
        if ($raw === []) return true;
        return update_option($this->option_name(), [], false);
    }

    private function assert_value(mixed $value): void {
        try {
            json_encode($value, JSON_THROW_ON_ERROR, 32);
        } catch (Throwable) {
            throw new InvalidArgumentException('O storage público aceita apenas valores compatíveis com JSON.');
        }
    }
}

final class Kodety_Extension_Routes extends Kodety_Extension_Service {
    public function namespace(): string {
        return 'kodety/extensions/v1/' . $this->context->slug();
    }

    /**
     * @param array{methods?:string|array,callback:callable,permission:mixed,args?:array} $definition
     */
    public function register(string $route, array $definition): string {
        $this->context->require_permission('routes.register');
        $route = trim($route);
        if (
            $route === ''
            || strlen($route) > 200
            || preg_match('/[\x00-\x20\x7F]/', $route)
            || str_contains($route, '..')
            || str_contains($route, '//')
        ) {
            throw new InvalidArgumentException('Rota REST inválida.');
        }
        $route = '/' . ltrim($route, '/');
        $callback = $definition['callback'] ?? null;
        if (!is_callable($callback) || !array_key_exists('permission', $definition)) {
            throw new InvalidArgumentException('Rotas exigem callback e permission explícitos.');
        }
        $permission = $this->permission_callback($definition['permission']);
        $context = $this->context;
        $namespace = $this->namespace();
        $args = [
            'methods' => $definition['methods'] ?? 'GET',
            'callback' => static function (mixed $request) use ($context, $callback): mixed {
                try {
                    return $context->invoke($callback, [$request, $context]);
                } catch (Throwable $error) {
                    return $context->rest_callback_failure('route.callback', $error);
                }
            },
            'permission_callback' => $permission,
            'args' => is_array($definition['args'] ?? null) ? $definition['args'] : [],
        ];
        $register = static function () use ($namespace, $route, $args): void {
            register_rest_route($namespace, $route, $args, false);
        };
        if (function_exists('did_action') && did_action('rest_api_init')) $register();
        else add_action('rest_api_init', $register);
        return $namespace . $route;
    }

    private function permission_callback(mixed $permission): callable {
        if ($permission === 'public') return '__return_true';
        if ($permission === 'authenticated') {
            return static fn(): bool => is_user_logged_in();
        }
        if (is_array($permission) && is_string($permission['capability'] ?? null)) {
            $capability = (string) $permission['capability'];
            $this->context->require_declared_capability($capability);
            return static fn(): bool => current_user_can($capability);
        }
        if (is_callable($permission)) {
            $context = $this->context;
            return static function (mixed $request) use ($context, $permission): mixed {
                try {
                    return $context->invoke($permission, [$request, $context]);
                } catch (Throwable $error) {
                    return $context->rest_callback_failure('route.permission', $error);
                }
            };
        }
        throw new InvalidArgumentException('Permission de rota inválida. Use public, authenticated ou capability.');
    }
}

final class Kodety_Extension_Admin extends Kodety_Extension_Service {
    /** @param array<string,mixed> $definition */
    public function register_page(string $page, array $definition): string {
        $this->context->require_permission('admin.register');
        $page = $this->name($page);
        $title = trim((string) ($definition['title'] ?? ''));
        $menu_title = trim((string) ($definition['menu_title'] ?? $title));
        $capability = (string) ($definition['capability'] ?? '');
        $callback = $definition['callback'] ?? null;
        if ($title === '' || $menu_title === '' || !is_callable($callback)) {
            throw new InvalidArgumentException('Página administrativa exige title, menu_title e callback.');
        }
        $this->context->require_declared_capability($capability);
        $slug = 'kodety-extension-' . $this->context->slug() . '-' . str_replace('/', '-', $page);
        $parent = array_key_exists('parent', $definition) ? $definition['parent'] : 'kodety';
        $context = $this->context;
        $render = static function () use ($context, $callback, $capability): void {
            if (!current_user_can($capability)) {
                wp_die(esc_html__('Você não tem permissão para acessar esta página.', 'kodety'), '', ['response' => 403]);
            }
            $initial_buffer_level = ob_get_level();
            ob_start();
            try {
                $result = $context->invoke($callback, [$context]);
                if (is_string($result)) echo $result; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
                $output = '';
                while (ob_get_level() > $initial_buffer_level) {
                    $chunk = ob_get_clean();
                    if (is_string($chunk)) $output = $chunk . $output;
                }
                echo $output; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
            } catch (Throwable $error) {
                while (ob_get_level() > $initial_buffer_level) ob_end_clean();
                $context->report_callback_failure('admin.render', $error);
                echo '<div class="wrap"><div class="notice notice-error"><p>'
                    . esc_html(
                        'A extensão '
                        . $context->slug()
                        . ' não conseguiu renderizar esta página. Consulte os logs.'
                    )
                    . '</p></div></div>';
            }
        };
        add_action('admin_menu', static function () use (
            $parent,
            $title,
            $menu_title,
            $capability,
            $slug,
            $render,
            $definition
        ): void {
            if ($parent === null || $parent === '') {
                add_menu_page(
                    $title,
                    $menu_title,
                    $capability,
                    $slug,
                    $render,
                    (string) ($definition['icon'] ?? 'dashicons-admin-plugins'),
                    isset($definition['position']) ? (float) $definition['position'] : null
                );
                return;
            }
            add_submenu_page((string) $parent, $title, $menu_title, $capability, $slug, $render);
        });
        return $slug;
    }

    public function url(string $page = 'index'): string {
        $this->context->require_permission('admin.register');
        $page = str_replace('/', '-', $this->name($page));
        return admin_url('admin.php?page=' . rawurlencode(
            'kodety-extension-' . $this->context->slug() . '-' . $page
        ));
    }
}

final class Kodety_Extension_Media extends Kodety_Extension_Service {
    /** @return array<string,mixed>|null */
    public function get(int $attachment_id): ?array {
        $this->context->require_permission('media.read');
        if ($attachment_id <= 0 || get_post_type($attachment_id) !== 'attachment') return null;
        return [
            'id' => $attachment_id,
            'title' => get_the_title($attachment_id),
            'url' => wp_get_attachment_url($attachment_id) ?: '',
            'mime' => get_post_mime_type($attachment_id) ?: '',
            'alt' => (string) get_post_meta($attachment_id, '_wp_attachment_image_alt', true),
            'metadata' => wp_get_attachment_metadata($attachment_id) ?: [],
        ];
    }

    /** @return list<array<string,mixed>> */
    public function query(array $arguments = []): array {
        $this->context->require_permission('media.read');
        $ids = get_posts(array_merge([
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'posts_per_page' => 50,
            'fields' => 'ids',
        ], $arguments));
        $items = [];
        foreach (is_array($ids) ? $ids : [] as $id) {
            $item = $this->get((int) $id);
            if ($item) $items[] = $item;
        }
        return $items;
    }

    public function upload(array $file, int $parent_id = 0, string $capability = 'upload_files'): int|WP_Error {
        $this->context->require_permission('media.write');
        $this->context->require_declared_capability($capability);
        if (!current_user_can($capability)) {
            return new WP_Error('kodety_extension_media_forbidden', 'Sem permissão para enviar mídia.');
        }
        if (!function_exists('media_handle_sideload')) {
            require_once ABSPATH . 'wp-admin/includes/file.php';
            require_once ABSPATH . 'wp-admin/includes/media.php';
            require_once ABSPATH . 'wp-admin/includes/image.php';
        }
        return media_handle_sideload($file, $parent_id);
    }
}

final class Kodety_Extension_Auth extends Kodety_Extension_Service {
    public function is_authenticated(): bool {
        $this->context->require_permission('auth.read');
        return is_user_logged_in();
    }

    public function user_id(): int {
        $this->context->require_permission('auth.read');
        return get_current_user_id();
    }

    public function can(string $capability, mixed ...$arguments): bool {
        $this->context->require_permission('auth.read');
        $this->context->require_declared_capability($capability);
        return current_user_can($capability, ...$arguments);
    }

    public function create_nonce(string $action): string {
        $this->context->require_permission('auth.read');
        return wp_create_nonce($this->nonce_action($action));
    }

    public function verify_nonce(string $nonce, string $action): bool {
        $this->context->require_permission('auth.read');
        return wp_verify_nonce($nonce, $this->nonce_action($action)) !== false;
    }

    private function nonce_action(string $action): string {
        $action = strtolower(trim($action));
        if ($action === '' || !preg_match('/^[a-z0-9_.:-]+$/', $action)) {
            throw new InvalidArgumentException('Ação de nonce inválida.');
        }
        return 'kodety-extension:' . $this->context->slug() . ':' . $action;
    }
}

final class Kodety_Extension_UI extends Kodety_Extension_Service {
    public function notice(string $message, string $type = 'info'): string {
        $this->context->require_permission('ui.render');
        $type = in_array($type, ['info', 'success', 'warning', 'error'], true) ? $type : 'info';
        return '<div class="notice notice-' . esc_attr($type) . '"><p>' . esc_html($message) . '</p></div>';
    }

    public function button(string $label, string $url, bool $primary = true): string {
        $this->context->require_permission('ui.render');
        $class = $primary ? 'button button-primary' : 'button';
        return '<a class="' . esc_attr($class) . '" href="' . esc_url($url) . '">' . esc_html($label) . '</a>';
    }

    public function field(string $label, string $control_html, string $description = ''): string {
        $this->context->require_permission('ui.render');
        $description_html = $description === ''
            ? ''
            : '<p class="description">' . esc_html($description) . '</p>';
        return '<div class="kodety-extension-field"><label><strong>'
            . esc_html($label)
            . '</strong></label>'
            . $control_html
            . $description_html
            . '</div>';
    }
}

final class Kodety_Extension_Frontend extends Kodety_Extension_Service {
    /**
     * Resolve request-scoped generated-theme context through the supported
     * runtime filter. The extension callback receives the selected runtime
     * arguments followed by its own public context.
     */
    public function register_runtime_context_resolver(
        callable $resolver,
        int $priority = 10,
        int $accepted_args = 1
    ): string {
        $this->context->require_permission('frontend.register');
        $this->validate_filter_registration($priority, $accepted_args, 1);
        $context = $this->context;
        add_filter(
            'kodety_runtime_context',
            static function (mixed $runtime_context) use ($context, $resolver, $accepted_args): array {
                $current = is_array($runtime_context) ? $runtime_context : [];
                $arguments = array_slice([$current], 0, $accepted_args);
                $arguments[] = $context;
                try {
                    $resolved = $context->invoke($resolver, $arguments);
                } catch (Throwable $error) {
                    $context->report_callback_failure('runtime.context', $error);
                    return $current;
                }
                if (is_array($resolved)) return $resolved;
                $context->report_callback_failure(
                    'runtime.context',
                    new UnexpectedValueException('O resolver retornou um valor inválido.')
                );
                return $current;
            },
            $priority,
            1
        );
        return 'kodety_runtime_context';
    }

    /**
     * Transform the final generated-theme HTML. With accepted_args=2 the
     * callback receives HTML, runtime context and extension context; with 1 it
     * receives HTML and extension context.
     */
    public function register_runtime_html_transformer(
        callable $transformer,
        int $priority = 10,
        int $accepted_args = 2
    ): string {
        $this->context->require_permission('frontend.register');
        $this->validate_filter_registration($priority, $accepted_args, 2);
        $context = $this->context;
        add_filter(
            'kodety_runtime_html',
            static function (mixed $html, mixed $runtime_context = []) use (
                $context,
                $transformer,
                $accepted_args
            ): string {
                $current = is_string($html) ? $html : (is_scalar($html) ? (string) $html : '');
                $runtime_context = is_array($runtime_context) ? $runtime_context : [];
                $arguments = array_slice([$current, $runtime_context], 0, $accepted_args);
                $arguments[] = $context;
                try {
                    $transformed = $context->invoke($transformer, $arguments);
                } catch (Throwable $error) {
                    $context->report_callback_failure('runtime.html', $error);
                    return $current;
                }
                if (is_string($transformed)) return $transformed;
                $context->report_callback_failure(
                    'runtime.html',
                    new UnexpectedValueException('O transformer retornou um valor inválido.')
                );
                return $current;
            },
            $priority,
            2
        );
        return 'kodety_runtime_html';
    }

    public function shortcode(string $name, callable $renderer): string {
        $this->context->require_permission('frontend.register');
        $shortcode = 'kodety_'
            . str_replace('-', '_', $this->context->slug())
            . '_'
            . str_replace(['-', '/', '.'], '_', $this->name($name));
        $context = $this->context;
        add_shortcode(
            $shortcode,
            static function (array|string $attributes = [], ?string $content = null) use (
                $context,
                $renderer
            ): mixed {
                try {
                    return $context->invoke($renderer, [$attributes, $content, $context]);
                } catch (Throwable $error) {
                    $context->report_callback_failure('shortcode.render', $error);
                    return '';
                }
            }
        );
        return $shortcode;
    }

    public function asset_url(string $relative): string {
        $this->context->require_permission('frontend.read');
        $relative = str_replace('\\', '/', trim($relative));
        if (
            $relative === ''
            || str_starts_with($relative, '/')
            || str_contains('/' . $relative . '/', '/../')
            || str_contains($relative, "\0")
        ) {
            throw new InvalidArgumentException('Caminho de asset inválido.');
        }
        $file = realpath($this->context->root() . '/' . $relative);
        $root = realpath($this->context->root());
        if (!$file || !$root || !is_file($file) || !str_starts_with($file, rtrim($root, '/') . '/')) {
            throw new InvalidArgumentException('O asset não existe dentro da extensão.');
        }
        $uploads = wp_upload_dir();
        $basedir = realpath((string) ($uploads['basedir'] ?? ''));
        $baseurl = rtrim((string) ($uploads['baseurl'] ?? ''), '/');
        if (!$basedir || $baseurl === '' || !str_starts_with($file, rtrim($basedir, '/') . '/')) {
            throw new RuntimeException('Assets locais exigem storage de extensões sob o diretório público de uploads.');
        }
        $path = ltrim(substr($file, strlen($basedir)), '/');
        return $baseurl . '/' . implode('/', array_map('rawurlencode', explode('/', $path)));
    }

    public function enqueue_style(
        string $name,
        string $url,
        array $dependencies = [],
        ?string $version = null
    ): string {
        $this->context->require_permission('frontend.register');
        $handle = $this->handle($name);
        $url = esc_url_raw($url);
        if ($url === '') throw new InvalidArgumentException('URL de stylesheet inválida.');
        add_action('wp_enqueue_scripts', static fn(): mixed =>
            wp_enqueue_style($handle, $url, $dependencies, $version)
        );
        return $handle;
    }

    public function enqueue_script(
        string $name,
        string $url,
        array $dependencies = [],
        ?string $version = null,
        bool $footer = true
    ): string {
        $this->context->require_permission('frontend.register');
        $handle = $this->handle($name);
        $url = esc_url_raw($url);
        if ($url === '') throw new InvalidArgumentException('URL de script inválida.');
        add_action('wp_enqueue_scripts', static fn(): mixed =>
            wp_enqueue_script($handle, $url, $dependencies, $version, $footer)
        );
        return $handle;
    }

    private function handle(string $name): string {
        return 'kodety-extension-' . $this->context->slug() . '-' . str_replace(['/', '.'], '-', $this->name($name));
    }

    private function validate_filter_registration(
        int $priority,
        int $accepted_args,
        int $maximum_args
    ): void {
        if ($priority < -10000 || $priority > 10000) {
            throw new InvalidArgumentException('A prioridade do filtro deve ficar entre -10000 e 10000.');
        }
        if ($accepted_args < 1 || $accepted_args > $maximum_args) {
            throw new InvalidArgumentException(
                'accepted_args deve ficar entre 1 e ' . $maximum_args . ' para este filtro.'
            );
        }
    }
}

final class Kodety_Extension_Blocks extends Kodety_Extension_Service {
    /** @param array<string,mixed> $definition */
    public function register(string $name, array $definition): string {
        $this->context->require_permission('blocks.register');
        $name = str_replace('/', '-', $this->name($name));
        $title = trim((string) ($definition['title'] ?? ''));
        if ($title === '') throw new InvalidArgumentException('Block types exigem um title.');
        if (isset($definition['render']) && !is_callable($definition['render'])) {
            throw new InvalidArgumentException('O render do block type deve ser callable.');
        }
        if (isset($definition['render'])) {
            $renderer = $definition['render'];
            $context = $this->context;
            $definition['render'] = static function (
                array $attributes = [],
                string $content = ''
            ) use ($context, $renderer): mixed {
                try {
                    return $context->invoke($renderer, [$attributes, $content, $context]);
                } catch (Throwable $error) {
                    $context->report_callback_failure('block.render', $error);
                    return '';
                }
            };
        }
        return Kodety_Extension_API::instance()->register_block_type($this->context, $name, $definition);
    }
}

/** Returns the context for the entrypoint currently being loaded. */
function kodety_extension(): ?Kodety_Extension_Context {
    return Kodety_Extension_API::instance()->current();
}

function kodety_extension_api_version(): string {
    return Kodety_Extension_API::VERSION;
}

/** @return array<string,array<string,mixed>> */
function kodety_extension_block_types(): array {
    return Kodety_Extension_API::instance()->block_types();
}
