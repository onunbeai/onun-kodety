<?php

/**
 * Isolated CMS persistence ACK and rollback contracts.
 *
 * Run with: php Wordpress/tests/cms-item-persistence-runtime.php
 */

define('ABSPATH', __DIR__);
define('REST_REQUEST', false);

final class WP_Error {
    public function __construct(
        private string $code = '',
        private string $message = '',
        private mixed $data = null
    ) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

final class WP_Post {
    public function __construct(
        public int $ID,
        public string $post_type = 'post',
        public string $post_title = 'Original',
        public string $post_name = 'original',
        public string $post_content = '',
        public string $post_excerpt = '',
        public string $post_status = 'draft',
        public int $post_parent = 0,
        public int $post_author = 1,
    ) {}
}

final class WP_Post_Type {
    public bool $show_ui = true;
    public string $rest_base;
    public array $rewrite;
    public object $cap;
    public object $labels;
    public function __construct(public string $name = 'post') {
        $this->rest_base = $name === 'post' ? 'posts' : ($name === 'page' ? 'pages' : $name);
        $this->rewrite = ['slug' => $this->rest_base];
        $this->cap = (object) [
            'edit_posts' => 'edit_posts',
            'create_posts' => 'edit_posts',
            'publish_posts' => 'publish_posts',
            'edit_others_posts' => 'edit_posts',
            'edit_published_posts' => 'edit_posts',
            'read_private_posts' => 'edit_posts',
        ];
        $this->labels = (object) ['name' => 'Posts', 'singular_name' => 'Post'];
    }
}

final class WP_REST_Request implements ArrayAccess {
    /** @param array<string,mixed> $route @param array<string,mixed> $params */
    public function __construct(private array $route = [], private array $params = []) {}
    public function get_param(string $key): mixed { return $this->params[$key] ?? null; }
    public function get_route(): string { return (string) ($this->params['_route'] ?? ''); }
    public function offsetExists(mixed $offset): bool { return array_key_exists((string) $offset, $this->route); }
    public function offsetGet(mixed $offset): mixed { return $this->route[(string) $offset] ?? null; }
    public function offsetSet(mixed $offset, mixed $value): void { $this->route[(string) $offset] = $value; }
    public function offsetUnset(mixed $offset): void { unset($this->route[(string) $offset]); }
}

final class WP_REST_Response {
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function get_data(): mixed { return $this->data; }
    public function get_status(): int { return $this->status; }
}

final class WP_Query {
    /** @var list<WP_Post> */
    public array $posts = [];
    public int $found_posts = 0;
    public int $max_num_pages = 0;
    /** @var array<string,mixed> */
    private array $arguments = [];

    /** @param array<string,mixed> $arguments */
    public function __construct(array $arguments = []) {
        global $kodety_cms_posts;
        $this->arguments = $arguments;
        $post_types = array_map('strval', (array) ($arguments['post_type'] ?? []));
        if (in_array('any', $post_types, true)) $post_types = [];
        $statuses = array_map('strval', (array) ($arguments['post_status'] ?? []));
        if (in_array('any', $statuses, true)) $statuses = [];
        $scope = '';
        $allow_unscoped = false;
        $has_scope_constraint = false;
        $meta_query = $arguments['meta_query'] ?? [];
        $inspect_scope = static function (mixed $node) use (&$inspect_scope, &$scope, &$allow_unscoped, &$has_scope_constraint): void {
            if (!is_array($node)) return;
            if (($node['key'] ?? '') === '_kodety_project_id') {
                $has_scope_constraint = true;
                if (($node['compare'] ?? '') === '=') $scope = (string) ($node['value'] ?? '');
                if (($node['compare'] ?? '') === 'NOT EXISTS') $allow_unscoped = true;
                return;
            }
            foreach ($node as $child) $inspect_scope($child);
        };
        $inspect_scope($meta_query);
        foreach ($kodety_cms_posts as $post) {
            if ($post_types !== [] && !in_array($post->post_type, $post_types, true)) continue;
            if ($statuses !== [] && !in_array($post->post_status, $statuses, true)) continue;
            if ($has_scope_constraint) {
                $item_scope = (string) get_post_meta($post->ID, '_kodety_project_id', true);
                if ($scope !== '' && $item_scope !== $scope && !($allow_unscoped && $item_scope === '')) continue;
                if ($scope === '' && $allow_unscoped && $item_scope !== '') continue;
            }
            $this->posts[] = $post;
        }
        $this->found_posts = count($this->posts);
        $per_page = max(1, (int) ($arguments['posts_per_page'] ?? 50));
        $this->max_num_pages = $this->found_posts === 0 ? 0 : (int) ceil($this->found_posts / $per_page);
    }

    public function get(string $key): mixed { return $this->arguments[$key] ?? null; }
    public function set(string $key, mixed $value): void { $this->arguments[$key] = $value; }
    /** @return array<string,mixed> */
    public function arguments(): array { return $this->arguments; }
}

/** @var array<int,WP_Post> */
$kodety_cms_posts = [];
/** @var array<int,array<string,mixed>> */
$kodety_cms_meta = [];
/** @var array<string,mixed> */
$kodety_cms_options = [];
/** @var array<string,array<string,mixed>> */
$kodety_cms_acf_fields = [];
/** @var array<int,array<string,mixed>> */
$kodety_cms_acf_values = [];
/** @var array<string,mixed> */
$kodety_cms_faults = [];
$kodety_cms_actions = 0;
$kodety_cms_acf_updates = 0;
$kodety_cms_registered = 0;
$kodety_cms_flushes = 0;
$kodety_cms_next_post_id = 100;
$kodety_cms_denied_capabilities = [];

function kodety_cms_reset(): void {
    global $kodety_cms_posts, $kodety_cms_meta, $kodety_cms_options, $kodety_cms_acf_fields,
        $kodety_cms_acf_values, $kodety_cms_faults, $kodety_cms_actions, $kodety_cms_acf_updates,
        $kodety_cms_registered, $kodety_cms_flushes, $kodety_cms_next_post_id;
    global $kodety_cms_denied_capabilities;
    $kodety_cms_posts = [
        1 => new WP_Post(1),
        20 => new WP_Post(20, 'attachment', 'Image', 'image'),
        21 => new WP_Post(21, 'attachment', 'Second image', 'second-image'),
    ];
    $kodety_cms_meta = [
        1 => ['summary' => 'old', '_thumbnail_id' => 20],
        20 => ['_wp_attachment_image_alt' => 'old alt'],
        21 => ['_wp_attachment_image_alt' => 'second alt'],
    ];
    $kodety_cms_options = [
        'kodety_collections' => [],
        'kodety_field_definitions' => [
            'post' => [[
                'name' => 'summary',
                'label' => 'Summary',
                'type' => 'text',
                'description' => '',
                'required' => false,
                'default' => '',
                'min' => '',
                'max' => '',
                'step' => 1,
                'unit' => '',
            ]],
        ],
        'kodety_cms_templates' => [],
    ];
    $kodety_cms_acf_fields = [];
    $kodety_cms_acf_values = [];
    $kodety_cms_faults = [];
    $kodety_cms_actions = 0;
    $kodety_cms_acf_updates = 0;
    $kodety_cms_registered = 0;
    $kodety_cms_flushes = 0;
    $kodety_cms_next_post_id = 100;
    $kodety_cms_denied_capabilities = [];
}

function kodety_cms_consume_fault(string $name, mixed $target = true): bool {
    global $kodety_cms_faults;
    if (!array_key_exists($name, $kodety_cms_faults)) return false;
    if (is_array($kodety_cms_faults[$name])) {
        if (($kodety_cms_faults[$name][0] ?? null) !== $target) return false;
        array_shift($kodety_cms_faults[$name]);
        if ($kodety_cms_faults[$name] === []) unset($kodety_cms_faults[$name]);
        return true;
    }
    if ($kodety_cms_faults[$name] !== $target) return false;
    unset($kodety_cms_faults[$name]);
    return true;
}

function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function add_action(...$arguments): void {}
function add_filter(...$arguments): void {}
function current_user_can(string $capability, mixed ...$arguments): bool {
    global $kodety_cms_denied_capabilities;
    return !in_array($capability, $kodety_cms_denied_capabilities, true);
}
function is_admin(): bool { return false; }
function absint(mixed $value): int { return abs((int) $value); }
function sanitize_key(string $value): string { return preg_replace('/[^a-z0-9_-]/', '', strtolower($value)) ?: ''; }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function sanitize_textarea_field(string $value): string { return trim(strip_tags($value)); }
function sanitize_file_name(string $value): string { return preg_replace('/[^a-zA-Z0-9._-]/', '-', basename($value)) ?: ''; }
function sanitize_title(string $value): string { return trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($value)), '-'); }
function current_time(string $type): string { return $type === 'c' ? '2026-01-01T00:00:00+00:00' : '2026-01-01 00:00:00'; }
function sanitize_hex_color(string $value): string|false { return preg_match('/^#[0-9a-f]{6}$/i', $value) ? strtolower($value) : false; }
function rest_sanitize_boolean(mixed $value): bool { return filter_var($value, FILTER_VALIDATE_BOOLEAN); }
function esc_url_raw(string $value): string { return filter_var($value, FILTER_VALIDATE_URL) ? $value : ''; }
function wp_kses_post(string $value): string { return preg_replace('~<script\b[^>]*>.*?</script>~is', '', $value) ?: ''; }
function wp_parse_url(string $value, int $component = -1): mixed { return parse_url($value, $component); }
function untrailingslashit(string $value): string { return rtrim($value, '/\\'); }
function maybe_serialize(mixed $value): mixed { return is_array($value) || is_object($value) ? serialize($value) : $value; }
function wp_slash(mixed $value): mixed {
    if (is_array($value)) return array_map('wp_slash', $value);
    return is_string($value) ? addslashes($value) : $value;
}
function wp_unslash(mixed $value): mixed {
    if (is_array($value)) return array_map('wp_unslash', $value);
    return is_string($value) ? stripslashes($value) : $value;
}
function get_post_type_object(string $post_type): ?WP_Post_Type {
    return in_array($post_type, ['post', 'page'], true) || post_type_exists($post_type)
        ? new WP_Post_Type($post_type)
        : null;
}
function get_post_types(array $arguments = [], string $output = 'names'): array {
    global $kodety_cms_posts;
    $types = ['post' => new WP_Post_Type('post'), 'page' => new WP_Post_Type('page')];
    foreach ($kodety_cms_posts as $post) {
        if ($post->post_type === 'attachment' || isset($types[$post->post_type])) continue;
        $types[$post->post_type] = new WP_Post_Type($post->post_type);
    }
    return $output === 'objects' ? $types : array_keys($types);
}
function post_type_supports(string $post_type, string $feature): bool { return $post_type !== 'attachment'; }
function post_type_exists(string $post_type): bool {
    global $kodety_cms_posts;
    if (in_array($post_type, ['post', 'page', 'attachment'], true)) return true;
    foreach ($kodety_cms_posts as $post) if ($post->post_type === $post_type) return true;
    return false;
}
function register_post_type(string $post_type, array $arguments): void {
    global $kodety_cms_registered;
    ++$kodety_cms_registered;
}
function flush_rewrite_rules(bool $hard = true): void {
    global $kodety_cms_flushes;
    ++$kodety_cms_flushes;
}
function get_option(string $key, mixed $default = false): mixed {
    global $kodety_cms_options;
    return array_key_exists($key, $kodety_cms_options) ? $kodety_cms_options[$key] : $default;
}
function update_option(string $key, mixed $value, mixed $autoload = null): bool {
    global $kodety_cms_options;
    if (kodety_cms_consume_fault('option', $key)) return false;
    $changed = !array_key_exists($key, $kodety_cms_options) || $kodety_cms_options[$key] !== $value;
    $kodety_cms_options[$key] = $value;
    return $changed;
}
function get_post(int|WP_Post $post): ?WP_Post {
    global $kodety_cms_posts;
    if ($post instanceof WP_Post) return $post;
    return $kodety_cms_posts[$post] ?? null;
}
function get_post_status(int $post_id): string|false { return get_post($post_id)?->post_status ?? false; }
function get_post_stati(): array { return ['publish' => 'publish', 'draft' => 'draft', 'pending' => 'pending', 'future' => 'future', 'private' => 'private', 'trash' => 'trash']; }
function get_posts(array $arguments = []): array {
    global $plugin;
    $query = new WP_Query($arguments);
    // Real WP_Query dispatches pre_get_posts before evaluating SQL. Rebuild
    // from the mutated arguments so migration queries cannot accidentally pass
    // only because this isolated runtime skipped the production hook.
    if (isset($plugin) && $plugin instanceof Kodety_Plugin) {
        $plugin->scope_agency_cms_query($query);
        $query = new WP_Query($query->arguments());
    }
    return ($arguments['fields'] ?? '') === 'ids'
        ? array_map(static fn(WP_Post $post): int => $post->ID, $query->posts)
        : $query->posts;
}
function wp_unique_post_slug(string $slug, int $post_id, string $status, string $post_type, int $parent): string {
    return $slug;
}
function wp_update_post(array $postarr, bool $wp_error = false, bool $fire_after_hooks = true): int|WP_Error {
    global $kodety_cms_posts, $kodety_cms_faults;
    $postarr = wp_unslash($postarr);
    $post_id = (int) ($postarr['ID'] ?? 0);
    if (kodety_cms_consume_fault('post_return_zero')) return 0;
    if (!isset($kodety_cms_posts[$post_id])) return new WP_Error('invalid_post');
    $drop = $kodety_cms_faults['post_drop'] ?? null;
    if ($drop !== null) unset($kodety_cms_faults['post_drop']);
    foreach (['post_title', 'post_excerpt', 'post_content', 'post_status', 'post_name'] as $field) {
        if (array_key_exists($field, $postarr) && $drop !== $field) $kodety_cms_posts[$post_id]->{$field} = (string) $postarr[$field];
    }
    return $post_id;
}
function wp_insert_post(array $postarr, bool $wp_error = false): int|WP_Error {
    global $kodety_cms_posts, $kodety_cms_next_post_id;
    $postarr = wp_unslash($postarr);
    $id = ++$kodety_cms_next_post_id;
    $kodety_cms_posts[$id] = new WP_Post(
        $id,
        (string) ($postarr['post_type'] ?? 'post'),
        (string) ($postarr['post_title'] ?? ''),
        sanitize_title((string) ($postarr['post_title'] ?? '')),
        '',
        '',
        (string) ($postarr['post_status'] ?? 'draft'),
    );
    return $id;
}
function wp_delete_post(int $post_id, bool $force_delete = false): WP_Post|false|null {
    global $kodety_cms_posts, $kodety_cms_meta;
    if (kodety_cms_consume_fault('delete_post', $post_id)) return false;
    if (!isset($kodety_cms_posts[$post_id])) return null;
    $post = $kodety_cms_posts[$post_id];
    unset($kodety_cms_posts[$post_id], $kodety_cms_meta[$post_id]);
    return $post;
}
function wp_trash_post(int $post_id): WP_Post|false|null {
    global $kodety_cms_posts;
    if (!isset($kodety_cms_posts[$post_id])) return null;
    if (kodety_cms_consume_fault('trash_post', $post_id)) return false;
    $kodety_cms_posts[$post_id]->post_status = 'trash';
    return $kodety_cms_posts[$post_id];
}
function metadata_exists(string $type, int $object_id, string $key): bool {
    global $kodety_cms_meta;
    return array_key_exists($key, $kodety_cms_meta[$object_id] ?? []);
}
function get_post_meta(int $object_id, string $key = '', bool $single = false): mixed {
    global $kodety_cms_meta;
    if ($key === '') return $kodety_cms_meta[$object_id] ?? [];
    if (!metadata_exists('post', $object_id, $key)) return $single ? '' : [];
    $value = $kodety_cms_meta[$object_id][$key];
    return $single ? $value : [$value];
}
function update_post_meta(int $object_id, string $key, mixed $value): int|bool {
    global $kodety_cms_meta;
    if (kodety_cms_consume_fault('meta', $object_id . ':' . $key)) return false;
    $value = wp_unslash($value);
    $changed = !metadata_exists('post', $object_id, $key) || $kodety_cms_meta[$object_id][$key] !== $value;
    $kodety_cms_meta[$object_id][$key] = $value;
    return $changed ? 1 : false;
}
function delete_post_meta(int $object_id, string $key): bool {
    global $kodety_cms_meta;
    if (!metadata_exists('post', $object_id, $key)) return false;
    unset($kodety_cms_meta[$object_id][$key]);
    return true;
}
function get_post_thumbnail_id(int|WP_Post $post): int {
    $id = $post instanceof WP_Post ? $post->ID : $post;
    return (int) get_post_meta($id, '_thumbnail_id', true);
}
function set_post_thumbnail(int $post_id, int $attachment_id): int|bool {
    if (kodety_cms_consume_fault('thumbnail', $post_id)) return false;
    return update_post_meta($post_id, '_thumbnail_id', $attachment_id);
}
function delete_post_thumbnail(int $post_id): bool {
    if (kodety_cms_consume_fault('thumbnail', $post_id)) return false;
    return delete_post_meta($post_id, '_thumbnail_id');
}
function wp_attachment_is_image(int $attachment_id): bool {
    return get_post($attachment_id)?->post_type === 'attachment';
}
function attachment_url_to_postid(string $url): int {
    return match ($url) {
        'https://example.test/image.jpg' => 20,
        'https://example.test/second.jpg' => 21,
        default => 0,
    };
}
function clean_post_cache(int $post_id): void {}
function get_current_user_id(): int { return 1; }
function home_url(string $path = ''): string { return 'https://example.test/' . ltrim($path, '/'); }
function user_trailingslashit(string $path): string { return rtrim($path, '/') . '/'; }
function get_the_title(int|WP_Post $post): string { return get_post($post)?->post_title ?? ''; }
function get_the_excerpt(int|WP_Post $post): string { return get_post($post)?->post_excerpt ?? ''; }
function get_the_date(string $format = '', int|WP_Post|null $post = null): string { return '2026-08-29'; }
function get_the_author_meta(string $field, int $user_id = 0): string { return 'Editor'; }
function get_edit_post_link(int|WP_Post $post, string $context = 'display'): string { return 'https://example.test/wp-admin/post.php?post=' . (get_post($post)?->ID ?? 0); }
function get_post_time(string $format = 'U', bool $gmt = false, int|WP_Post|null $post = null): string { return '2026-08-29T12:00:00+00:00'; }
function get_post_modified_time(string $format = 'U', bool $gmt = false, int|WP_Post|null $post = null): string { return '2026-08-29T12:00:00+00:00'; }
function wp_get_attachment_image_url(int $attachment_id, string|array $size = 'thumbnail'): string|false {
    return match ($attachment_id) {
        20 => 'https://example.test/image.jpg',
        21 => 'https://example.test/second.jpg',
        default => false,
    };
}
function do_action(string $hook, mixed ...$arguments): void {
    global $kodety_cms_actions;
    if ($hook === 'kodety_cms_item_saved') ++$kodety_cms_actions;
}
function get_field_object(string $selector, int $post_id, bool $format = false, bool $load = false): array|false {
    global $kodety_cms_acf_fields;
    foreach ($kodety_cms_acf_fields as $field) {
        if ($selector === $field['name'] || $selector === $field['key']) return $field;
    }
    return false;
}
function update_field(string $selector, mixed $value, int $post_id): bool|WP_Error {
    global $kodety_cms_acf_fields, $kodety_cms_acf_values, $kodety_cms_acf_updates, $kodety_cms_meta;
    $field = get_field_object($selector, $post_id, false, false);
    if (!is_array($field)) return false;
    ++$kodety_cms_acf_updates;
    if (kodety_cms_consume_fault('acf', $field['name'])) return false;
    $value = wp_unslash($value);
    $changed = ($kodety_cms_acf_values[$post_id][$field['name']] ?? null) !== $value;
    $kodety_cms_acf_values[$post_id][$field['name']] = $value;
    $kodety_cms_meta[$post_id][$field['name']] = $value;
    $kodety_cms_meta[$post_id]['_' . $field['name']] = $field['key'];
    return $changed;
}
function get_field(string $selector, int $post_id, bool $format = true): mixed {
    global $kodety_cms_acf_values;
    $field = get_field_object($selector, $post_id, false, false);
    return is_array($field) ? ($kodety_cms_acf_values[$post_id][$field['name']] ?? false) : false;
}
function acf_validate_value(mixed $value, array $field, string $input): bool {
    return !kodety_cms_consume_fault('acf_validation', $field['name']);
}
function acf_flush_value_cache(int $post_id, string $field): void {}

require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_cms_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_cms_apply(Kodety_Plugin $plugin, array $values): ?WP_Error {
    static $method = null;
    if (!$method instanceof ReflectionMethod) {
        $method = new ReflectionMethod(Kodety_Plugin::class, 'apply_cms_item_values');
        $method->setAccessible(true);
    }
    /** @var ?WP_Error $result */
    $result = $method->invoke($plugin, 1, $values);
    return $result;
}

function kodety_cms_private(Kodety_Plugin $plugin, string $method_name, mixed ...$arguments): mixed {
    static $methods = [];
    if (!isset($methods[$method_name])) {
        $methods[$method_name] = new ReflectionMethod(Kodety_Plugin::class, $method_name);
        $methods[$method_name]->setAccessible(true);
    }
    return $methods[$method_name]->invoke($plugin, ...$arguments);
}

function kodety_cms_schema_revision(Kodety_Plugin $plugin): string {
    return (string) kodety_cms_private($plugin, 'cms_schema_revision');
}

function kodety_cms_item_revision(Kodety_Plugin $plugin, WP_Post $post): string {
    return (string) kodety_cms_private($plugin, 'cms_item_revision', $post);
}

$plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();

kodety_cms_reset();
$result = kodety_cms_apply($plugin, ['field:summary' => 'old']);
kodety_cms_assert($result === null && $kodety_cms_actions === 1, 'meta inalterada deve ser sucesso por readback');

kodety_cms_reset();
$kodety_cms_faults['meta'] = '1:summary';
$result = kodety_cms_apply($plugin, ['title' => 'Changed', 'field:summary' => 'new']);
kodety_cms_assert(is_wp_error($result), 'falha silenciosa de meta deve retornar erro');
kodety_cms_assert($kodety_cms_posts[1]->post_title === 'Original' && get_post_meta(1, 'summary', true) === 'old', 'falha de meta deve restaurar post e meta');
kodety_cms_assert($kodety_cms_actions === 0, 'hook não deve disparar antes do ACK completo');

kodety_cms_reset();
$kodety_cms_faults['post_drop'] = 'post_title';
$result = kodety_cms_apply($plugin, ['title' => 'Changed']);
kodety_cms_assert(is_wp_error($result) && $kodety_cms_posts[1]->post_title === 'Original', 'post update descartado deve falhar pelo readback');

kodety_cms_reset();
$kodety_cms_acf_fields['summary'] = ['name' => 'summary', 'key' => 'field_summary', 'type' => 'text', 'required' => false];
$result = kodety_cms_apply($plugin, ['field:summary' => 'native wins']);
kodety_cms_assert($result === null && get_post_meta(1, 'summary', true) === 'native wins', 'campo Kodety deve persistir em meta nativa');
kodety_cms_assert($kodety_cms_acf_updates === 0, 'colisão de nome não deve desviar campo Kodety ao ACF');

kodety_cms_reset();
$kodety_cms_options['kodety_field_definitions']['post'] = [];
$kodety_cms_acf_fields['hero'] = ['name' => 'hero', 'key' => 'field_hero', 'type' => 'image', 'required' => true];
$result = kodety_cms_apply($plugin, ['field:hero' => 'https://example.test/second.jpg']);
kodety_cms_assert($result === null && get_field('field_hero', 1, false) === 21, 'imagem ACF deve converter URL em attachment ID');
kodety_cms_assert(get_post_meta(1, '_hero', true) === 'field_hero', 'referência ACF também precisa de ACK');

kodety_cms_reset();
$kodety_cms_options['kodety_field_definitions']['post'] = [];
$kodety_cms_acf_fields['external'] = ['name' => 'external', 'key' => 'field_external', 'type' => 'text', 'required' => false];
$kodety_cms_faults['acf'] = 'external';
$result = kodety_cms_apply($plugin, ['title' => 'Changed', 'field:external' => 'new']);
kodety_cms_assert(is_wp_error($result) && $kodety_cms_posts[1]->post_title === 'Original', 'falha ACF deve restaurar campos nativos anteriores');
kodety_cms_assert($kodety_cms_actions === 0, 'falha ACF não deve disparar hook');

kodety_cms_reset();
$kodety_cms_faults['thumbnail'] = 1;
$result = kodety_cms_apply($plugin, ['featured_image' => 21]);
kodety_cms_assert(is_wp_error($result) && get_post_thumbnail_id(1) === 20, 'thumbnail sem ACK deve falhar e preservar a anterior');

kodety_cms_reset();
$kodety_cms_faults['meta'] = '21:_wp_attachment_image_alt';
$result = kodety_cms_apply($plugin, ['featured_image' => 21, 'featured_image_alt' => 'new alt']);
kodety_cms_assert(is_wp_error($result), 'alt sem ACK deve falhar');
kodety_cms_assert(get_post_thumbnail_id(1) === 20 && get_post_meta(21, '_wp_attachment_image_alt', true) === 'second alt', 'falha de alt deve restaurar thumbnail e alt');

kodety_cms_reset();
$result = kodety_cms_apply($plugin, ['status' => 'invalid']);
kodety_cms_assert(is_wp_error($result) && $result->get_error_code() === 'kodety_invalid_status', 'status inválido deve ser rejeitado');
$result = kodety_cms_apply($plugin, ['date' => '2026-07-27']);
kodety_cms_assert(is_wp_error($result) && $result->get_error_code() === 'kodety_readonly_field', 'campo somente leitura não pode ser ignorado com sucesso');

kodety_cms_reset();
$kodety_cms_faults['option'] = 'kodety_collections';
$response = $plugin->create_collection(new WP_REST_Request([], [
    'name' => 'Projects',
    'singular' => 'Project',
    'slug' => 'projects',
    'expectedRevision' => kodety_cms_schema_revision($plugin),
]));
kodety_cms_assert(is_wp_error($response), 'collection sem option ACK deve falhar');
kodety_cms_assert($kodety_cms_options['kodety_collections'] === [] && $kodety_cms_registered === 0 && $kodety_cms_flushes === 0, 'collection stale não pode ser registrada');

kodety_cms_reset();
$legacy_collections = [[
    'slug' => 'post',
    'name' => 'Posts',
    'singular' => 'Post',
    'urlSlug' => 'posts',
    'fields' => [['name' => 'legacy']],
]];
$kodety_cms_options['kodety_collections'] = $legacy_collections;
$previous_fields = $kodety_cms_options['kodety_field_definitions'];
$kodety_cms_faults['option'] = 'kodety_collections';
$response = $plugin->save_cms_fields(new WP_REST_Request(
    ['post_type' => 'post'],
    [
        'fields' => [['name' => 'subtitle', 'label' => 'Subtitle', 'type' => 'text']],
        'expectedRevision' => kodety_cms_schema_revision($plugin),
    ]
));
kodety_cms_assert(is_wp_error($response), 'segunda option de fields sem ACK deve falhar');
kodety_cms_assert($kodety_cms_options['kodety_field_definitions'] === $previous_fields, 'fields deve ser restaurado quando collection option falha');
kodety_cms_assert($kodety_cms_options['kodety_collections'] === $legacy_collections, 'collection legacy deve ser restaurada na falha');

kodety_cms_reset();
$kodety_cms_faults['option'] = 'kodety_cms_templates';
$response = $plugin->save_cms_template(new WP_REST_Request([], [
    'postType' => 'post',
    'htmlPath' => 'posts.html',
    'expectedRevision' => kodety_cms_schema_revision($plugin),
]));
kodety_cms_assert(is_wp_error($response) && $kodety_cms_options['kodety_cms_templates'] === [], 'template sem readback não pode retornar sucesso');

kodety_cms_reset();
$template_revision = kodety_cms_schema_revision($plugin);
$response = $plugin->save_cms_template(new WP_REST_Request([], [
    'postType' => 'post',
    'htmlPath' => 'posts.html',
    'expectedRevision' => $template_revision,
]));
kodety_cms_assert($response instanceof WP_REST_Response, 'template deve salvar sob lock com revision atual');
$template_state = $kodety_cms_options['kodety_cms_templates'];
$response = $plugin->save_cms_template(new WP_REST_Request([], [
    'postType' => 'post',
    'htmlPath' => 'other.html',
    'expectedRevision' => $template_revision,
]));
kodety_cms_assert(
    is_wp_error($response)
        && $response->get_error_code() === 'kodety_revision_conflict'
        && $kodety_cms_options['kodety_cms_templates'] === $template_state,
    'template stale deve falhar sem sobrescrever schema'
);

kodety_cms_reset();
$kodety_cms_faults['meta'] = '101:summary';
$response = $plugin->create_cms_item(new WP_REST_Request(
    ['post_type' => 'post'],
    [
        'values' => ['title' => 'Created', 'status' => 'draft', 'field:summary' => 'new'],
        'expectedRevision' => kodety_cms_schema_revision($plugin),
    ]
));
kodety_cms_assert(is_wp_error($response) && !isset($kodety_cms_posts[101]), 'criação com falha tardia deve remover o item parcial');

kodety_cms_reset();
$import_revision = kodety_cms_schema_revision($plugin);
$response = $plugin->import_cms_items(new WP_REST_Request(
    ['post_type' => 'post'],
    [
        'items' => [
            ['values' => ['title' => 'Imported A', 'field:summary' => 'a']],
            ['values' => ['title' => 'Imported B', 'field:summary' => 'b']],
        ],
        'expectedRevision' => $import_revision,
    ]
));
kodety_cms_assert(
    $response instanceof WP_REST_Response
        && ($response->get_data()['imported'] ?? 0) === 2
        && isset($kodety_cms_posts[101], $kodety_cms_posts[102])
        && $kodety_cms_actions === 2,
    'import deve confirmar o lote inteiro sob um lock antes de emitir hooks'
);
$posts_after_import = array_keys($kodety_cms_posts);
$kodety_cms_options['kodety_field_definitions']['post'][] = [
    'name' => 'changed',
    'label' => 'Changed',
    'type' => 'text',
    'description' => '',
    'required' => false,
    'default' => '',
    'min' => '',
    'max' => '',
    'step' => 1,
    'unit' => '',
];
$response = $plugin->import_cms_items(new WP_REST_Request(
    ['post_type' => 'post'],
    [
        'items' => [['values' => ['title' => 'Stale import']]],
        'expectedRevision' => $import_revision,
    ]
));
kodety_cms_assert(
    is_wp_error($response)
        && $response->get_error_code() === 'kodety_revision_conflict'
        && array_keys($kodety_cms_posts) === $posts_after_import
        && $kodety_cms_actions === 2,
    'import stale deve falhar antes de inserir item ou emitir hook'
);

// Every GET surface used by an editor carries an opaque revision that can be
// sent back by a later compare-and-swap mutation.
kodety_cms_reset();
$types_payload = $plugin->cms_types()->get_data();
$schema_payload = $plugin->cms_schema()->get_data();
$fields_payload = $plugin->cms_fields(new WP_REST_Request(['post_type' => 'post']))->get_data();
$items_payload = $plugin->cms_items(new WP_REST_Request(['post_type' => 'post']))->get_data();
$single_item_payload = $plugin->cms_item(new WP_REST_Request(['post_type' => 'post', 'post_id' => 1]))->get_data();
foreach ([$types_payload, $schema_payload, $fields_payload, $items_payload] as $payload) {
    kodety_cms_assert(
        is_array($payload) && preg_match('/^kodety-cms-v1-[a-f0-9]{64}$/', (string) ($payload['revision'] ?? '')) === 1,
        'GET CMS deve retornar revision opaca'
    );
}
kodety_cms_assert(
    preg_match('/^kodety-cms-v1-[a-f0-9]{64}$/', (string) ($items_payload['items'][0]['revision'] ?? '')) === 1,
    'cada item listado deve retornar revision própria'
);
kodety_cms_assert(
    preg_match('/^kodety-cms-v1-[a-f0-9]{64}$/', (string) ($single_item_payload['revision'] ?? '')) === 1,
    'GET de item individual deve retornar a mesma revision opaca'
);

// Two tabs updating one collection: only the holder of the current revision
// wins. Stable route identifiers remain byte-for-byte identical and PUT does
// not flush rewrite rules.
kodety_cms_reset();
$kodety_cms_options['kodety_collections'] = [[
    'slug' => 'post',
    'name' => 'Posts',
    'singular' => 'Post',
    'urlSlug' => 'posts',
    'fields' => [],
    'metadata' => ['owner' => 'fixture'],
    'bindings' => [['field' => 'summary', 'selector' => '[data-title]']],
]];
$kodety_cms_options['kodety_cms_templates'] = ['post' => 'posts.html'];
$collections_before_rename = $kodety_cms_options['kodety_collections'];
$fields_before_rename = $kodety_cms_options['kodety_field_definitions'];
$templates_before_rename = $kodety_cms_options['kodety_cms_templates'];
$tab_revision = kodety_cms_schema_revision($plugin);
$response = $plugin->update_collection(new WP_REST_Request(
    ['post_type' => 'post'],
    ['name' => 'Articles', 'singular' => 'Article', 'expectedRevision' => $tab_revision]
));
kodety_cms_assert($response instanceof WP_REST_Response, 'primeira aba deve renomear labels com revision atual');
$renamed = $kodety_cms_options['kodety_collections'][0];
$renamed_revision = (string) ($response->get_data()['revision'] ?? '');
$expected_renamed_collections = $collections_before_rename;
$expected_renamed_collections[0]['name'] = 'Articles';
$expected_renamed_collections[0]['singular'] = 'Article';
kodety_cms_assert(
    $kodety_cms_options['kodety_collections'] === $expected_renamed_collections
        && $kodety_cms_options['kodety_field_definitions'] === $fields_before_rename
        && $kodety_cms_options['kodety_cms_templates'] === $templates_before_rename
        && $renamed['slug'] === 'post'
        && $renamed['urlSlug'] === 'posts'
        && $renamed['metadata'] === ['owner' => 'fixture']
        && $renamed['bindings'] === [['field' => 'summary', 'selector' => '[data-title]']]
        && $kodety_cms_flushes === 0,
    'PUT deve alterar só labels e preservar slug/urlSlug/fields/templates/bindings byte-identical sem flush'
);
$state_after_tab_a = $kodety_cms_options['kodety_collections'];
$actions_after_tab_a = $kodety_cms_actions;
$response = $plugin->update_collection(new WP_REST_Request(
    ['post_type' => 'post'],
    ['name' => 'News', 'singular' => 'News item', 'expectedRevision' => $tab_revision]
));
$conflict_data = is_wp_error($response) ? $response->get_error_data() : null;
kodety_cms_assert(
    is_wp_error($response)
        && $response->get_error_code() === 'kodety_revision_conflict'
        && is_array($conflict_data)
        && ($conflict_data['status'] ?? 0) === 409
        && ($conflict_data['resource'] ?? '') === 'collection:post'
        && ($conflict_data['expectedRevision'] ?? '') === $tab_revision
        && ($conflict_data['revision'] ?? '') === $renamed_revision
        && is_array($conflict_data['current'] ?? null),
    'segunda aba stale deve receber contrato 409 com revisão e estado atuais'
);
kodety_cms_assert(
    $kodety_cms_options['kodety_collections'] === $state_after_tab_a && $kodety_cms_actions === $actions_after_tab_a,
    'conflito de schema não pode alterar estado nem disparar hook'
);
$response = $plugin->update_collection(new WP_REST_Request(
    ['post_type' => 'post'],
    [
        'name' => 'Articles',
        'singular' => 'Article',
        'urlSlug' => 'POSTS',
        'expectedRevision' => $renamed_revision,
    ]
));
kodety_cms_assert(
    is_wp_error($response)
        && $response->get_error_code() === 'kodety_collection_slug_immutable'
        && $kodety_cms_options['kodety_collections'] === $state_after_tab_a,
    'qualquer tentativa de trocar urlSlug deve ser rejeitada sem normalizar ou regravar'
);
$fields_tab_revision = kodety_cms_schema_revision($plugin);
$response = $plugin->save_cms_fields(new WP_REST_Request(
    ['post_type' => 'post'],
    [
        'fields' => [['name' => 'subtitle', 'label' => 'Subtitle', 'type' => 'text']],
        'expectedRevision' => $fields_tab_revision,
    ]
));
kodety_cms_assert($response instanceof WP_REST_Response, 'fields POST deve aceitar revision atual');
$fields_after_tab_a = $kodety_cms_options['kodety_field_definitions'];
$response = $plugin->save_cms_fields(new WP_REST_Request(
    ['post_type' => 'post'],
    [
        'fields' => [['name' => 'deck', 'label' => 'Deck', 'type' => 'text']],
        'expectedRevision' => $fields_tab_revision,
    ]
));
kodety_cms_assert(
    is_wp_error($response)
        && $response->get_error_code() === 'kodety_revision_conflict'
        && $kodety_cms_options['kodety_field_definitions'] === $fields_after_tab_a,
    'fields POST stale deve retornar conflito sem sobrescrever schema'
);

// Collection deletion is confirmation + CAS + empty-only. It never cascades
// and a sibling project's item with the same post type is preserved.
kodety_cms_reset();
$definition = [
    'slug' => 'post',
    'name' => 'Posts A',
    'singular' => 'Post A',
    'urlSlug' => 'posts-a',
    'fields' => [],
];
$kodety_cms_options['kodety_workspace_project_id'] = 'project-a';
$kodety_cms_options['kodety_collections__project_project-a'] = [$definition];
$kodety_cms_options['kodety_field_definitions__project_project-a'] = ['post' => [['name' => 'summary']]];
$kodety_cms_options['kodety_cms_templates__project_project-a'] = ['post' => 'posts.html'];
$kodety_cms_meta[1]['_kodety_project_id'] = 'project-a';
$delete_revision = kodety_cms_schema_revision($plugin);
$options_before_delete = $kodety_cms_options;
$response = $plugin->delete_collection(new WP_REST_Request(
    ['post_type' => 'post'],
    ['confirmation' => 'post', 'deleteItems' => true, 'expectedRevision' => $delete_revision]
));
kodety_cms_assert(
    is_wp_error($response)
        && $response->get_error_code() === 'kodety_collection_cascade_forbidden'
        && $kodety_cms_options === $options_before_delete
        && isset($kodety_cms_posts[1]),
    'deleteItems:true deve falhar antes de qualquer mutação'
);
$response = $plugin->delete_collection(new WP_REST_Request(
    ['post_type' => 'post'],
    ['confirmation' => 'post', 'deleteItems' => false, 'expectedRevision' => $delete_revision]
));
$not_empty_data = is_wp_error($response) ? $response->get_error_data() : null;
kodety_cms_assert(
    is_wp_error($response)
        && $response->get_error_code() === 'kodety_collection_not_empty'
        && is_array($not_empty_data)
        && ($not_empty_data['status'] ?? 0) === 409
        && ($not_empty_data['itemCount'] ?? 0) === 1
        && $kodety_cms_options === $options_before_delete
        && $kodety_cms_flushes === 0,
    'collection não vazia deve retornar 409 sem options/delete/flush'
);
$kodety_cms_posts[1]->post_status = 'trash';
$kodety_cms_posts[2] = new WP_Post(2, 'post', 'Sibling item', 'sibling-item');
$kodety_cms_meta[2] = ['_kodety_project_id' => 'project-b'];
$project_a_types = $plugin->cms_types()->get_data()['types'] ?? [];
$project_a_post_type = array_values(array_filter(
    $project_a_types,
    static fn(array $type): bool => ($type['slug'] ?? '') === 'post'
))[0] ?? [];
kodety_cms_assert(
    ($project_a_post_type['itemCount'] ?? -1) === 0,
    'itemCount do projeto A deve ignorar lixeira e item do mesmo post type owned pelo projeto B'
);
$response = $plugin->delete_collection(new WP_REST_Request(
    ['post_type' => 'post'],
    ['confirmation' => 'post', 'deleteItems' => false, 'expectedRevision' => $delete_revision]
));
kodety_cms_assert($response instanceof WP_REST_Response, 'item irmão não deve bloquear exclusão da definição vazia do projeto A');
kodety_cms_assert(
    ($kodety_cms_options['kodety_collections__project_project-a'] ?? null) === []
        && ($kodety_cms_options['kodety_field_definitions__project_project-a'] ?? null) === []
        && ($kodety_cms_options['kodety_cms_templates__project_project-a'] ?? null) === []
        && isset($kodety_cms_posts[1])
        && $kodety_cms_posts[1]->post_status === 'trash'
        && isset($kodety_cms_posts[2])
        && $kodety_cms_posts[2]->post_status === 'draft',
    'delete vazio deve remover schema sem purgar lixeira nem tocar item do projeto B'
);

kodety_cms_reset();
$kodety_cms_options['kodety_collections'] = [$definition];
$kodety_cms_options['kodety_field_definitions'] = ['post' => [['name' => 'summary']]];
$kodety_cms_options['kodety_cms_templates'] = ['post' => 'posts.html'];
unset($kodety_cms_posts[1]);
$kodety_cms_faults['option'] = ['kodety_cms_templates', 'kodety_collections'];
$response = $plugin->delete_collection(new WP_REST_Request(
    ['post_type' => 'post'],
    [
        'confirmation' => 'post',
        'deleteItems' => false,
        'expectedRevision' => kodety_cms_schema_revision($plugin),
    ]
));
kodety_cms_assert(
    is_wp_error($response)
        && $response->get_error_code() === 'kodety_collection_persistence_failed'
        && !empty($response->get_error_data()['rollbackFailed'])
        && $kodety_cms_options['kodety_field_definitions'] === ['post' => [['name' => 'summary']]]
        && $kodety_cms_options['kodety_cms_templates'] === ['post' => 'posts.html'],
    'rollback deve tentar fields e template mesmo quando restore da definição falha'
);

// Two tabs updating one item. CAS is evaluated under the shared writer lock,
// so a stale request has zero writes and zero saved hooks.
kodety_cms_reset();
$kodety_cms_options['kodety_workspace_project_id'] = 'project-a';
$kodety_cms_options['kodety_collections__project_project-a'] = [$definition];
$kodety_cms_options['kodety_field_definitions__project_project-a'] = $kodety_cms_options['kodety_field_definitions'];
$kodety_cms_options['kodety_cms_templates__project_project-a'] = [];
$kodety_cms_meta[1]['_kodety_project_id'] = 'project-a';
$items_payload = $plugin->cms_items(new WP_REST_Request(['post_type' => 'post']))->get_data();
$item_revision = (string) ($items_payload['items'][0]['revision'] ?? '');
$response = $plugin->update_cms_item(new WP_REST_Request(
    ['post_type' => 'post', 'post_id' => 1],
    ['values' => ['title' => 'Tab A', 'field:summary' => 'tab-a'], 'expectedRevision' => $item_revision]
));
kodety_cms_assert($response instanceof WP_REST_Response, 'primeira aba deve salvar item com revision atual');
$next_item_revision = (string) ($response->get_data()['revision'] ?? '');
kodety_cms_assert($next_item_revision !== $item_revision && $kodety_cms_actions === 1, 'sucesso deve retornar revision nova e emitir um hook');
$item_state_after_tab_a = [$kodety_cms_posts[1]->post_title, get_post_meta(1, 'summary', true)];
$response = $plugin->update_cms_item(new WP_REST_Request(
    ['post_type' => 'post', 'post_id' => 1],
    ['values' => ['title' => 'Tab B', 'field:summary' => 'tab-b'], 'expectedRevision' => $item_revision]
));
$item_conflict = is_wp_error($response) ? $response->get_error_data() : null;
kodety_cms_assert(
    is_wp_error($response)
        && $response->get_error_code() === 'kodety_revision_conflict'
        && is_array($item_conflict)
        && ($item_conflict['status'] ?? 0) === 409
        && ($item_conflict['resource'] ?? '') === 'item:post:1'
        && ($item_conflict['expectedRevision'] ?? '') === $item_revision
        && ($item_conflict['revision'] ?? '') === $next_item_revision,
    'item stale deve retornar contrato 409 com revisão atual'
);
kodety_cms_assert(
    [$kodety_cms_posts[1]->post_title, get_post_meta(1, 'summary', true)] === $item_state_after_tab_a
        && $kodety_cms_actions === 1,
    'item stale deve produzir zero efeitos e zero hooks adicionais'
);

// Same WordPress post type in projects A/B remains isolated. A stamped item is
// a 404 after switching workspace, while B's own item stays editable.
$kodety_cms_options['kodety_collections__project_project-b'] = [[
    ...$definition,
    'name' => 'Posts B',
    'singular' => 'Post B',
    'urlSlug' => 'posts-b',
]];
$kodety_cms_options['kodety_field_definitions__project_project-b'] = $kodety_cms_options['kodety_field_definitions'];
$kodety_cms_options['kodety_cms_templates__project_project-b'] = [];
$kodety_cms_posts[2] = new WP_Post(2, 'post', 'Project B', 'project-b');
$kodety_cms_meta[2] = ['summary' => 'b', '_kodety_project_id' => 'project-b'];
$kodety_cms_options['kodety_workspace_project_id'] = 'project-b';
$response = $plugin->update_cms_item(new WP_REST_Request(
    ['post_type' => 'post', 'post_id' => 1],
    ['values' => ['title' => 'Cross-project'], 'expectedRevision' => $next_item_revision]
));
kodety_cms_assert(
    is_wp_error($response) && $response->get_error_code() === 'kodety_invalid_item' && ($response->get_error_data()['status'] ?? 0) === 404,
    'item do projeto A deve ser 404 no projeto B'
);
$project_b_revision = kodety_cms_item_revision($plugin, $kodety_cms_posts[2]);
$response = $plugin->update_cms_item(new WP_REST_Request(
    ['post_type' => 'post', 'post_id' => 2],
    ['values' => ['title' => 'Project B updated'], 'expectedRevision' => $project_b_revision]
));
kodety_cms_assert(
    $response instanceof WP_REST_Response
        && $kodety_cms_posts[2]->post_title === 'Project B updated'
        && $kodety_cms_posts[1]->post_title === 'Tab A',
    'projeto B deve editar apenas seu próprio item do mesmo post type'
);
$project_b_items = $plugin->cms_items(new WP_REST_Request(['post_type' => 'post']))->get_data();
kodety_cms_assert(
    array_map(static fn(array $item): int => (int) $item['id'], $project_b_items['items']) === [2],
    'listagem do projeto B não pode expor item stamped do projeto A'
);

// A type that exists only in project A is still registered globally in agency
// mode. Project B must treat the type and every stamped item as nonexistent.
kodety_cms_reset();
$portfolio_definition = [
    ...$definition,
    'slug' => 'portfolio',
    'name' => 'Portfolio',
    'singular' => 'Portfolio item',
    'urlSlug' => 'work',
];
$kodety_cms_options['kodety_workspace_project_id'] = 'project-b';
$kodety_cms_options['kodety_agency_projects'] = [
    'project-a' => ['name' => 'Project A', 'slug' => 'project-a'],
    'project-b' => ['name' => 'Project B', 'slug' => 'project-b'],
];
$kodety_cms_options['kodety_collections__project_project-a'] = [$portfolio_definition];
$kodety_cms_options['kodety_collections__project_project-b'] = [];
$kodety_cms_options['kodety_field_definitions__project_project-a'] = ['portfolio' => [['name' => 'summary']]];
$kodety_cms_options['kodety_field_definitions__project_project-b'] = [];
$kodety_cms_options['kodety_cms_templates__project_project-a'] = ['portfolio' => 'portfolio.html'];
$kodety_cms_options['kodety_cms_templates__project_project-b'] = [];
$kodety_cms_posts[3] = new WP_Post(3, 'portfolio', 'A only', 'a-only');
$kodety_cms_meta[3] = ['summary' => 'project-a', '_kodety_project_id' => 'project-a'];
$exclusive_snapshot = [
    'posts' => serialize($kodety_cms_posts),
    'meta' => $kodety_cms_meta,
    'options' => $kodety_cms_options,
    'actions' => $kodety_cms_actions,
    'nextPostId' => $kodety_cms_next_post_id,
];
$project_b_types = $plugin->cms_types()->get_data()['types'] ?? [];
kodety_cms_assert(
    array_values(array_filter($project_b_types, static fn(array $type): bool => ($type['slug'] ?? '') === 'portfolio')) === [],
    'types/schema do projeto B não podem revelar collection exclusiva do projeto A'
);
foreach ([
    $plugin->cms_fields(new WP_REST_Request(['post_type' => 'portfolio'])),
    $plugin->cms_items(new WP_REST_Request(['post_type' => 'portfolio'])),
    $plugin->cms_item(new WP_REST_Request(['post_type' => 'portfolio', 'post_id' => 3])),
    $plugin->save_cms_fields(new WP_REST_Request(
        ['post_type' => 'portfolio'],
        ['fields' => [], 'expectedRevision' => 'stale-cross-project-revision']
    )),
    $plugin->create_cms_item(new WP_REST_Request(
        ['post_type' => 'portfolio'],
        ['values' => ['title' => 'Cross-project'], 'expectedRevision' => 'stale-cross-project-revision']
    )),
    $plugin->import_cms_items(new WP_REST_Request(
        ['post_type' => 'portfolio'],
        ['items' => [['values' => ['title' => 'Cross-project']]], 'expectedRevision' => 'stale-cross-project-revision']
    )),
    $plugin->update_cms_item(new WP_REST_Request(
        ['post_type' => 'portfolio', 'post_id' => 3],
        ['values' => ['title' => 'Cross-project'], 'expectedRevision' => kodety_cms_item_revision($plugin, $kodety_cms_posts[3])]
    )),
    $plugin->delete_cms_item(new WP_REST_Request(
        ['post_type' => 'portfolio', 'post_id' => 3],
        ['expectedRevision' => kodety_cms_item_revision($plugin, $kodety_cms_posts[3])]
    )),
] as $out_of_scope_response) {
    kodety_cms_assert(
        is_wp_error($out_of_scope_response)
            && ($out_of_scope_response->get_error_data()['status'] ?? 0) === 404,
        'rota CMS de tipo exclusivo de outro projeto deve responder 404'
    );
}
$native_scope_guard = $plugin->enforce_free_rest_item_limit(
    $kodety_cms_posts[3],
    new WP_REST_Request([], ['type' => 'portfolio', 'id' => 3])
);
kodety_cms_assert(
    is_wp_error($native_scope_guard)
        && ($native_scope_guard->get_error_data()['status'] ?? 0) === 404
        && $plugin->enforce_free_item_limit_on_insert(false, ['post_type' => 'portfolio']) === true
        && $plugin->protect_read_only_cms_items(['edit_posts'], 'edit_post', 1, [3]) === ['do_not_allow'],
    'writers WordPress nativos também devem falhar fechados para tipo/item de projeto irmão'
);
kodety_cms_assert(
    serialize($kodety_cms_posts) === $exclusive_snapshot['posts']
        && $kodety_cms_meta === $exclusive_snapshot['meta']
        && $kodety_cms_options === $exclusive_snapshot['options']
        && $kodety_cms_actions === $exclusive_snapshot['actions']
        && $kodety_cms_next_post_id === $exclusive_snapshot['nextPostId'],
    'tentativas cross-project devem produzir zero mutações em posts, meta, options e hooks'
);
$kodety_cms_options['kodety_workspace_project_id'] = 'project-a';
$project_a_types = $plugin->cms_types()->get_data()['types'] ?? [];
$project_a_portfolio = array_values(array_filter(
    $project_a_types,
    static fn(array $type): bool => ($type['slug'] ?? '') === 'portfolio'
))[0] ?? [];
$project_a_portfolio_items = $plugin->cms_items(new WP_REST_Request(['post_type' => 'portfolio']))->get_data();
kodety_cms_assert(
    ($project_a_portfolio['collection'] ?? false) === true
        && ($project_a_portfolio['itemCount'] ?? 0) === 1
        && array_map(static fn(array $item): int => (int) $item['id'], $project_a_portfolio_items['items'] ?? []) === [3]
        && $plugin->cms_fields(new WP_REST_Request(['post_type' => 'portfolio'])) instanceof WP_REST_Response,
    'projeto proprietário deve continuar vendo seu tipo, schema e item'
);

// Upgrade the truly legacy unsuffixed store exactly once, then prove that a
// second workspace cannot inherit schema or an unscoped published item.
kodety_cms_reset();
$legacy_portfolio = [
    ...$definition,
    'slug' => 'portfolio',
    'name' => 'Legacy Portfolio A',
    'singular' => 'Legacy Portfolio item',
    'urlSlug' => 'legacy-work',
];
$kodety_cms_options['kodety_workspace_project_id'] = 'project-a';
$kodety_cms_options['kodety_agency_projects'] = [
    'project-a' => ['name' => 'Project A', 'slug' => 'project-a'],
    'project-b' => ['name' => 'Project B', 'slug' => 'project-b'],
];
$kodety_cms_options['kodety_collections'] = [$legacy_portfolio];
$kodety_cms_options['kodety_field_definitions'] = ['portfolio' => [['name' => 'summary']]];
$kodety_cms_options['kodety_cms_templates'] = ['portfolio' => 'legacy-portfolio.html'];
$kodety_cms_posts[3] = new WP_Post(3, 'portfolio', 'Legacy A secret', 'legacy-a', '', '', 'publish');
$kodety_cms_meta[3] = ['summary' => 'private legacy value'];
kodety_cms_assert(
    kodety_cms_private($plugin, 'migrate_legacy_cms_project_scope') === true
        && $kodety_cms_options['kodety_cms_legacy_scope_owner'] === 'project-a'
        && $kodety_cms_options['kodety_collections__project_project-a'] === [$legacy_portfolio]
        && $kodety_cms_options['kodety_field_definitions__project_project-a'] === ['portfolio' => [['name' => 'summary']]]
        && $kodety_cms_options['kodety_cms_templates__project_project-a'] === ['portfolio' => 'legacy-portfolio.html']
        && get_post_meta(3, '_kodety_project_id', true) === 'project-a',
    'migração deve materializar options e ownership do legado no workspace já montado'
);
$kodety_cms_options['kodety_workspace_project_id'] = 'project-b';
kodety_cms_assert(
    kodety_cms_private($plugin, 'project_cms_option_for_scope', 'kodety_collections', 'project-b', []) === [],
    'namespace ausente do projeto B deve ser vazio, nunca fallback para o legado de A'
);
$legacy_b_types = $plugin->cms_types()->get_data()['types'] ?? [];
kodety_cms_assert(
    array_values(array_filter($legacy_b_types, static fn(array $type): bool => ($type['slug'] ?? '') === 'portfolio')) === [],
    'inventário do projeto B não pode revelar o tipo legado migrado para A'
);
$legacy_b_item_request = new WP_REST_Request(
    ['post_type' => 'portfolio', 'post_id' => 3, 'id' => 3],
    ['_route' => '/wp/v2/portfolio/3']
);
foreach ([
    $plugin->cms_item($legacy_b_item_request),
    $plugin->cms_items(new WP_REST_Request(['post_type' => 'portfolio'])),
    $plugin->can_access_cms_item($legacy_b_item_request, 'edit'),
    $plugin->protect_project_cms_rest_item(null, [], $legacy_b_item_request),
] as $legacy_b_denial) {
    kodety_cms_assert(
        is_wp_error($legacy_b_denial) && ($legacy_b_denial->get_error_data()['status'] ?? 0) === 404,
        'rotas Kodety e core REST devem responder 404 antes de expor item legado de A em B'
    );
}
kodety_cms_assert(
    $plugin->protect_read_only_cms_items(['edit_posts'], 'edit_post', 1, [1]) === ['edit_posts'],
    'map_meta_cap não pode bloquear post WordPress comum sem vínculo de projeto'
);
$ordinary_items = $plugin->cms_items(new WP_REST_Request(['post_type' => 'post']))->get_data();
$ordinary_read = $plugin->cms_item(new WP_REST_Request(['post_type' => 'post', 'post_id' => 1]));
$ordinary_create = $plugin->create_cms_item(new WP_REST_Request(
    ['post_type' => 'post'],
    [
        'values' => ['title' => 'Ordinary WordPress post'],
        'expectedRevision' => kodety_cms_schema_revision($plugin),
    ]
));
$ordinary_created_id = $ordinary_create instanceof WP_REST_Response
    ? (int) ($ordinary_create->get_data()['id'] ?? 0)
    : 0;
kodety_cms_assert(
    array_map(static fn(array $item): int => (int) $item['id'], $ordinary_items['items'] ?? []) === [1]
        && $ordinary_read instanceof WP_REST_Response
        && $ordinary_create instanceof WP_REST_Response
        && $ordinary_create->get_status() === 201
        && $ordinary_created_id > 0
        && !metadata_exists('post', $ordinary_created_id, '_kodety_project_id')
        && $plugin->cms_item(new WP_REST_Request([
            'post_type' => 'post',
            'post_id' => $ordinary_created_id,
        ])) instanceof WP_REST_Response,
    'tipo WordPress ordinário deve preservar itens unscoped e criar registros que continuam acessíveis'
);

// Even when both projects intentionally use the same post type, list and
// direct core REST reads must select only the exact stamped workspace.
$kodety_cms_options['kodety_collections__project_project-b'] = [[
    ...$legacy_portfolio,
    'name' => 'Portfolio B',
    'urlSlug' => 'work-b',
]];
$kodety_cms_options['kodety_field_definitions__project_project-b'] = ['portfolio' => [['name' => 'summary']]];
$kodety_cms_options['kodety_cms_templates__project_project-b'] = [];
$kodety_cms_posts[4] = new WP_Post(4, 'portfolio', 'Project B item', 'project-b-item', '', '', 'publish');
$kodety_cms_meta[4] = ['summary' => 'b', '_kodety_project_id' => 'project-b'];
$same_type_items = $plugin->cms_items(new WP_REST_Request(['post_type' => 'portfolio']))->get_data();
$project_b_core_request = new WP_REST_Request(
    ['id' => 4],
    ['_route' => '/wp/v2/portfolio/4']
);
$non_post_core_request = new WP_REST_Request(
    ['id' => 3],
    ['_route' => '/wp/v2/users/3']
);
kodety_cms_assert(
    array_map(static fn(array $item): int => (int) $item['id'], $same_type_items['items'] ?? []) === [4]
        && $plugin->protect_project_cms_rest_item(null, [], $legacy_b_item_request) instanceof WP_Error
        && $plugin->protect_project_cms_rest_item(null, [], $project_b_core_request) === null
        && $plugin->protect_project_cms_rest_item(null, [], $non_post_core_request) === null,
    'mesmo post type deve isolar itens sem afetar outro endpoint core que reutiliza o mesmo id'
);
$generic_rest_query = new WP_Query(['post_type' => 'any']);
$plugin->scope_agency_cms_query($generic_rest_query);
$generic_meta_query = $generic_rest_query->get('meta_query');
kodety_cms_assert(
    is_array($generic_meta_query)
        && serialize($generic_meta_query) === serialize([[
            'relation' => 'OR',
            ['key' => '_kodety_project_id', 'value' => 'project-b', 'compare' => '='],
            ['key' => '_kodety_project_id', 'compare' => 'NOT EXISTS'],
        ]]),
    'query genérica deve excluir ownership irmão sem esconder posts WordPress sem scope'
);
$existing_or = [
    'relation' => 'OR',
    ['key' => 'summary', 'value' => 'a', 'compare' => '='],
    ['key' => 'summary', 'value' => 'b', 'compare' => '='],
];
$composed_query = new WP_Query(['post_type' => 'any', 'meta_query' => $existing_or]);
$plugin->scope_agency_cms_query($composed_query);
$composed_meta_query = $composed_query->get('meta_query');
$composed_ids = get_posts(['post_type' => 'any', 'fields' => 'ids', 'meta_query' => $existing_or]);
kodety_cms_assert(
    serialize($composed_meta_query) === serialize([
        'relation' => 'AND',
        $existing_or,
        [
            'relation' => 'OR',
            ['key' => '_kodety_project_id', 'value' => 'project-b', 'compare' => '='],
            ['key' => '_kodety_project_id', 'compare' => 'NOT EXISTS'],
        ],
    ])
        && in_array(1, $composed_ids, true)
        && in_array(4, $composed_ids, true)
        && !in_array(3, $composed_ids, true),
    'ownership deve compor por AND com meta_query OR e filtrar sibling em busca pública/admin/AJAX'
);

$kodety_cms_options['kodety_collections__project_project-b'][0]['readOnly'] = true;
$kodety_cms_denied_capabilities = ['edit_post'];
$read_only_request = new WP_REST_Request(['post_type' => 'portfolio', 'post_id' => 4]);
kodety_cms_assert(
    $plugin->can_access_cms_item($read_only_request, 'read') === true
        && $plugin->can_access_cms_item($read_only_request, 'edit') === false
        && array_map(
            static fn(array $item): int => (int) $item['id'],
            $plugin->cms_items(new WP_REST_Request(['post_type' => 'portfolio']))->get_data()['items'] ?? []
        ) === [4],
    'collection readOnly deve permitir ACL de leitura sem reabrir edição'
);
$kodety_cms_denied_capabilities = ['read_post'];
kodety_cms_assert(
    $plugin->can_access_cms_item($read_only_request, 'read') === false,
    'GET de item ainda deve respeitar read_post para draft/private e ownership de autor'
);
$kodety_cms_denied_capabilities = [];

// A partial migration pins its owner before any copy, so another workspace
// cannot claim the same legacy store while the first one is retryable.
kodety_cms_reset();
$kodety_cms_options['kodety_workspace_project_id'] = 'project-a';
$kodety_cms_options['kodety_collections'] = [$legacy_portfolio];
$kodety_cms_options['kodety_field_definitions'] = ['portfolio' => [['name' => 'summary']]];
$kodety_cms_options['kodety_cms_templates'] = [];
$kodety_cms_faults['option'] = 'kodety_field_definitions__project_project-a';
kodety_cms_assert(
    kodety_cms_private($plugin, 'migrate_legacy_cms_project_scope') === false
        && ($kodety_cms_options['kodety_cms_legacy_scope_owner'] ?? '') === 'project-a',
    'falha parcial deve manter claim retryable do owner original'
);
$kodety_cms_options['kodety_workspace_project_id'] = 'project-b';
kodety_cms_assert(
    kodety_cms_private($plugin, 'migrate_legacy_cms_project_scope') === false
        && !array_key_exists('kodety_collections__project_project-b', $kodety_cms_options),
    'workspace B não pode reclamar o legado durante retry da migração de A'
);

kodety_cms_reset();
$kodety_cms_options['kodety_workspace_project_id'] = 'project-a';
$kodety_cms_options['kodety_collections__project_project-a'] = [$definition];
$kodety_cms_options['kodety_field_definitions__project_project-a'] = $kodety_cms_options['kodety_field_definitions'];
$kodety_cms_options['kodety_cms_templates__project_project-a'] = [];
$kodety_cms_meta[1]['_kodety_project_id'] = 'project-a';
$delete_item_revision = kodety_cms_item_revision($plugin, $kodety_cms_posts[1]);
$response = $plugin->delete_cms_item(new WP_REST_Request(
    ['post_type' => 'post', 'post_id' => 1],
    ['expectedRevision' => str_repeat('0', strlen($delete_item_revision))]
));
kodety_cms_assert(
    is_wp_error($response)
        && $response->get_error_code() === 'kodety_revision_conflict'
        && $kodety_cms_posts[1]->post_status === 'draft',
    'DELETE de item stale deve preservar o item'
);
$response = $plugin->delete_cms_item(new WP_REST_Request(
    ['post_type' => 'post', 'post_id' => 1],
    ['expectedRevision' => $delete_item_revision]
));
kodety_cms_assert(
    $response instanceof WP_REST_Response
        && $kodety_cms_posts[1]->post_status === 'trash'
        && preg_match('/^kodety-cms-v1-[a-f0-9]{64}$/', (string) ($response->get_data()['revision'] ?? '')) === 1,
    'DELETE de item atual deve mover para lixeira e confirmar revision de readback'
);

kodety_cms_reset();
$internal_snapshot = $kodety_cms_options['kodety_field_definitions'];
$internal_next = $internal_snapshot;
$internal_next['post'][0]['label'] = 'Updated safely';
kodety_cms_assert(
    $plugin->update_project_cms_option('kodety_field_definitions', $internal_next) === false
        && $kodety_cms_options['kodety_field_definitions'] === $internal_snapshot,
    'writer interno sem snapshot deve falhar fechado'
);
kodety_cms_assert(
    $plugin->update_project_cms_option('kodety_field_definitions', $internal_next, $internal_snapshot) === true
        && $kodety_cms_options['kodety_field_definitions'] === $internal_next,
    'writer interno deve comparar snapshot dentro do lock e confirmar ACK'
);
$internal_stale_next = $internal_next;
$internal_stale_next['post'][0]['label'] = 'Stale overwrite';
kodety_cms_assert(
    $plugin->update_project_cms_option('kodety_field_definitions', $internal_stale_next, $internal_snapshot) === false
        && $kodety_cms_options['kodety_field_definitions'] === $internal_next,
    'writer interno stale não pode sobrescrever alteração concorrente'
);

echo "Kodety CMS persistence ACK contracts passed.\n";
