<?php
/**
 * Focused runtime regression for fail-safe native publication reconciliation.
 *
 * Run with: php Wordpress/tests/publication-sync-runtime.php
 */

declare(strict_types=1);

define('ABSPATH', sys_get_temp_dir() . '/kodety-publication-sync-wp/');
define('KODETY_DIR', dirname(__DIR__) . '/kodety/');
define('KODETY_VERSION', 'test-runtime-transaction');
define('DISABLE_WP_CRON', true);
define('MINUTE_IN_SECONDS', 60);
define('DAY_IN_SECONDS', 86400);
define('MB_IN_BYTES', 1024 * 1024);

final class WP_Error {
    public function __construct(
        private string $code = '',
        private string $message = '',
        private array $data = []
    ) {}

    public function get_error_message(): string {
        return $this->message;
    }
    public function get_error_code(): string { return $this->code; }
    public function get_error_data(): array { return $this->data; }
}

final class WP_REST_Response {
    public array $headers = [];
    public function __construct(private mixed $data, private int $status = 200) {}
    public function get_data(): mixed { return $this->data; }
    public function get_status(): int { return $this->status; }
    public function header(string $name, string $value): void { $this->headers[$name] = $value; }
}

final class WP_REST_Request implements ArrayAccess {
    public function __construct(
        private array $params = [],
        private array $headers = [],
        private string $body = ''
    ) {}
    public function get_param(string $name): mixed { return $this->params[$name] ?? null; }
    public function get_header(string $name): string { return (string) ($this->headers[strtolower($name)] ?? ''); }
    public function get_body(): string { return $this->body; }
    public function offsetExists(mixed $offset): bool { return isset($this->params[$offset]); }
    public function offsetGet(mixed $offset): mixed { return $this->params[$offset] ?? null; }
    public function offsetSet(mixed $offset, mixed $value): void { $this->params[$offset] = $value; }
    public function offsetUnset(mixed $offset): void { unset($this->params[$offset]); }
}

// This regression validates the complete runtime copy transaction. Simulate a
// valid license so license-gated redirects.php remains part of that fixture.
final class Kodety_License {
    public static function instance(): self { static $instance; return $instance ??= new self(); }
    public function is_active(): bool { return true; }
    public function public_status(): array { return ['valid' => true, 'limits' => []]; }
}

class WP_Post {
    public function __construct(
        public int $ID,
        public string $post_status = 'publish',
        public string $post_title = '',
        public string $post_name = ''
    ) {}
}

final class Kodety_Publication_Test_Theme {
    public function __construct(
        private string $directory,
        private string $stylesheet
    ) {}

    public function exists(): bool {
        return true;
    }

    public function get_stylesheet_directory(): string {
        return $this->directory;
    }

    public function get_stylesheet(): string {
        return $this->stylesheet;
    }
}

$test_root = sys_get_temp_dir() . '/kodety-publication-sync-' . bin2hex(random_bytes(5));
$theme_root = $test_root . '/theme';
$site_root = $theme_root . '/site';
$upload_root = $test_root . '/uploads';
mkdir($site_root . '/assets', 0777, true);
mkdir($upload_root, 0777, true);

$GLOBALS['kodety_publication_test'] = [
    'theme_root' => $theme_root,
    'active_theme' => 'test-active-theme',
    'upload_root' => $upload_root,
    'options' => [
        'kodety_current_release' => 'release-next',
        'kodety_assets_synced_release' => 'release-previous',
        'kodety_pages_synced_release' => 'release-previous',
        'page_on_front' => 999,
        'show_on_front' => 'posts',
    ],
    'attachments' => [
        900 => ['file' => $upload_root . '/kodety/assets/obsolete.png'],
    ],
    'pages' => [
        11 => new WP_Post(11),
        22 => new WP_Post(22),
        33 => new WP_Post(33),
    ],
    'meta' => [
        900 => [
            '_kodety_managed' => '1',
            '_kodety_asset_path' => 'assets/obsolete.png',
            '_kodety_asset_hash' => 'obsolete',
        ],
        11 => [
            '_kodety_managed' => '1',
            '_kodety_html_path' => 'index.html',
            '_kodety_route' => '',
            '_kodety_release' => 'release-previous',
        ],
        22 => [
            '_kodety_managed' => '1',
            '_kodety_html_path' => 'about.html',
            '_kodety_route' => 'about',
            '_kodety_release' => 'release-previous',
        ],
        33 => [
            '_kodety_managed' => '1',
            '_kodety_html_path' => 'legacy.html',
            '_kodety_route' => 'legacy',
            '_kodety_release' => 'release-previous',
        ],
    ],
    'next_attachment_id' => 1000,
    'next_page_id' => 40,
    'fail_attachment_title' => 'b',
    'fail_attached_file_title' => '',
    'fail_page_update_id' => 22,
    'fail_new_page_meta_key' => '',
    'fail_option_key' => '',
    'fail_trash_id' => 0,
    'deleted_attachments' => [],
    'trashed_pages' => [],
    'scheduled_events' => [],
    'runtime_fault_checkpoint' => '',
    'runtime_fault_file' => '',
    'runtime_fault_hits' => 0,
    'runtime_replaced_files' => [],
    'filters' => [],
    'metadata_calls' => [],
    'attachment_metadata' => [],
    'actions' => [],
    'cache_purges' => 0,
    'schedule_failure' => false,
];

function is_wp_error(mixed $value): bool {
    return $value instanceof WP_Error;
}

function is_multisite(): bool {
    return false;
}

function current_user_can(string $capability): bool {
    return in_array($capability, $GLOBALS['kodety_publication_test']['capabilities'] ?? ['upload_files', 'edit_pages'], true);
}
function get_current_user_id(): int { return 42; }
function add_action(...$args): void {}
function wp_cache_delete(string $key, string $group = ''): bool { return true; }

function admin_url(string $path = ''): string { return 'https://example.test/wp-admin/' . $path; }
function home_url(string $path = ''): string { return 'https://example.test/' . ltrim($path, '/'); }
function rest_url(string $path = ''): string { return 'https://example.test/wp-json/' . ltrim($path, '/'); }
function add_query_arg(array|string $arguments, string $value_or_url, ?string $url = null): string {
    return ($url ?? $value_or_url) . '?' . http_build_query(is_array($arguments) ? $arguments : [$arguments => $value_or_url]);
}
function wp_create_nonce(string $action): string { return hash('sha256', 'snapshot-test-' . $action); }
function wp_unslash(mixed $value): mixed { return $value; }
function esc_html(string $value): string { return htmlspecialchars($value, ENT_QUOTES, 'UTF-8'); }
function wp_die(string $message, string $title = '', array $arguments = []): never { throw new RuntimeException($message, (int) ($arguments['response'] ?? 500)); }
function check_admin_referer(string $action): void {
    if (($_GET['_wpnonce'] ?? '') !== wp_create_nonce($action)) wp_die('Nonce inválido.', '', ['response' => 403]);
}
function get_temp_dir(): string {
    $directory = $GLOBALS['kodety_publication_test']['upload_root'] . '/tmp/';
    wp_mkdir_p($directory);
    return $directory;
}
function wp_salt(string $scheme = 'auth'): string { return 'snapshot-test-salt-' . $scheme; }
function wp_generate_password(int $length = 12, bool $special = true, bool $extra = false): string { return substr(bin2hex(random_bytes($length)), 0, $length); }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function current_time(string $format): string { return gmdate($format === 'mysql' ? 'Y-m-d H:i:s' : $format); }
function set_transient(string $key, mixed $value, int $expiration): bool {
    $GLOBALS['kodety_publication_test']['transients'][$key] = ['value' => $value, 'expires' => time() + $expiration];
    return true;
}
function get_transient(string $key): mixed {
    $entry = $GLOBALS['kodety_publication_test']['transients'][$key] ?? null;
    return is_array($entry) && $entry['expires'] > time() ? $entry['value'] : false;
}

function add_filter(string $hook, callable $callback, int $priority = 10, int $accepted_args = 1): bool {
    $GLOBALS['kodety_publication_test']['filters'][$hook][$priority][] = [
        'callback' => $callback,
        'accepted_args' => $accepted_args,
    ];
    return true;
}

function remove_filter(string $hook, callable $callback, int $priority = 10): bool {
    $entries = &$GLOBALS['kodety_publication_test']['filters'][$hook][$priority];
    if (!is_array($entries)) return false;
    foreach ($entries as $index => $entry) {
        if (($entry['callback'] ?? null) !== $callback) continue;
        unset($entries[$index]);
        return true;
    }
    return false;
}

function apply_filters(string $hook, mixed $value, mixed ...$args): mixed {
    $state = &$GLOBALS['kodety_publication_test'];
    if ($hook === 'kodety_theme_runtime_transaction_fault') {
        $checkpoint = (string) ($args[0] ?? '');
        $file = (string) ($args[1] ?? '');
        $state['runtime_fault_hits']++;
        if ($checkpoint === 'after_commit') $state['runtime_replaced_files'][] = $file;
        if (
            $state['runtime_fault_checkpoint'] === $checkpoint
            && ($state['runtime_fault_file'] === '' || $state['runtime_fault_file'] === $file)
        ) {
            $value = 'falha transacional simulada em ' . $file;
        }
    }
    $priorities = $state['filters'][$hook] ?? [];
    if (!is_array($priorities)) return $value;
    ksort($priorities);
    foreach ($priorities as $entries) {
        foreach ((array) $entries as $entry) {
            $accepted = max(1, (int) ($entry['accepted_args'] ?? 1));
            $arguments = array_slice(array_merge([$value], $args), 0, $accepted);
            $value = ($entry['callback'])(...$arguments);
        }
    }
    return $value;
}

function do_action(string $hook, mixed ...$args): void {
    $GLOBALS['kodety_publication_test']['actions'][] = ['hook' => $hook, 'args' => $args];
}

function wp_cache_flush(): bool {
    $GLOBALS['kodety_publication_test']['cache_purges']++;
    return true;
}

function get_option(string $key, mixed $default = false): mixed {
    return $GLOBALS['kodety_publication_test']['options'][$key] ?? $default;
}

function update_option(string $key, mixed $value, mixed $autoload = null): bool {
    if ($GLOBALS['kodety_publication_test']['fail_option_key'] === $key) return false;
    $GLOBALS['kodety_publication_test']['options'][$key] = $value;
    return true;
}

function add_option(string $key, mixed $value, string $deprecated = '', mixed $autoload = null): bool {
    if (array_key_exists($key, $GLOBALS['kodety_publication_test']['options'])) return false;
    $GLOBALS['kodety_publication_test']['options'][$key] = $value;
    return true;
}

function delete_option(string $key): bool {
    unset($GLOBALS['kodety_publication_test']['options'][$key]);
    return true;
}

function wp_get_theme(string $stylesheet = ''): Kodety_Publication_Test_Theme {
    return new Kodety_Publication_Test_Theme(
        $GLOBALS['kodety_publication_test']['theme_root'],
        $stylesheet === 'kodety-generated'
            ? 'kodety-generated'
            : $GLOBALS['kodety_publication_test']['active_theme']
    );
}

function get_theme_root(): string {
    $directory = $GLOBALS['kodety_publication_test']['upload_root'] . '/themes';
    wp_mkdir_p($directory);
    return $directory;
}

function switch_theme(string $stylesheet): void {
    $GLOBALS['kodety_publication_test']['active_theme'] = $stylesheet;
    $GLOBALS['kodety_publication_test']['theme_root'] = get_theme_root() . '/' . $stylesheet;
}

function wp_upload_dir(): array {
    return [
        'basedir' => $GLOBALS['kodety_publication_test']['upload_root'],
        'baseurl' => 'https://example.test/uploads',
        'error' => false,
    ];
}

function trailingslashit(string $value): string {
    return rtrim($value, '/\\') . '/';
}

function wp_mkdir_p(string $directory): bool {
    return is_dir($directory) || mkdir($directory, 0777, true);
}

function sanitize_file_name(string $value): string {
    return preg_replace('/[^a-zA-Z0-9._-]+/', '-', $value) ?: '';
}

function sanitize_text_field(string $value): string {
    return trim(strip_tags($value));
}

function wp_strip_all_tags(string $value, bool $remove_breaks = false): string {
    $stripped = strip_tags($value);
    return $remove_breaks ? preg_replace('/[\r\n\t ]+/', ' ', $stripped) : $stripped;
}

function wp_trim_words(string $value, int $word_count = 55, ?string $more = null): string {
    $words = preg_split('/\s+/', trim($value), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    if (count($words) <= $word_count) return implode(' ', $words);
    return implode(' ', array_slice($words, 0, $word_count)) . ($more ?? '&hellip;');
}

function sanitize_title(string $value): string {
    return trim(strtolower((string) preg_replace('/[^a-z0-9]+/i', '-', $value)), '-');
}

function sanitize_key(string $value): string {
    return strtolower((string) preg_replace('/[^a-z0-9_-]/i', '', $value));
}

function wp_check_filetype(string $filename): array {
    return ['type' => str_ends_with(strtolower($filename), '.png') ? 'image/png' : 'application/octet-stream'];
}

function get_posts(array $query): array {
    $state = &$GLOBALS['kodety_publication_test'];
    if (($query['post_type'] ?? '') === 'page') {
        return array_values(array_filter(
            $state['pages'],
            static function (WP_Post $page) use (&$state): bool {
                $meta = $state['meta'][$page->ID] ?? [];
                return isset($meta['_kodety_managed'])
                    || array_key_exists('_kodety_html_path', $meta)
                    || array_key_exists('_kodety_route', $meta)
                    || array_key_exists('_kodety_release', $meta);
            }
        ));
    }
    if (($query['post_type'] ?? '') !== 'attachment') return [];
    $meta_key = (string) ($query['meta_key'] ?? '');
    $meta_value = $query['meta_value'] ?? null;
    $matches = [];
    foreach ($state['attachments'] as $attachment_id => $_attachment) {
        $stored = $state['meta'][$attachment_id][$meta_key] ?? null;
        if ($stored === $meta_value) $matches[] = (int) $attachment_id;
    }
    return $matches;
}

function get_post_meta(int $post_id, string $key, bool $single = false): mixed {
    return $GLOBALS['kodety_publication_test']['meta'][$post_id][$key] ?? ($single ? '' : []);
}

function update_post_meta(int $post_id, string $key, mixed $value): int|bool {
    $state = &$GLOBALS['kodety_publication_test'];
    if (
        $post_id >= 40
        && $post_id < 1000
        && $state['fail_new_page_meta_key'] !== ''
        && $key === $state['fail_new_page_meta_key']
    ) {
        return false;
    }
    $state['meta'][$post_id][$key] = $value;
    return true;
}

function delete_post_meta(int $post_id, string $key): bool {
    unset($GLOBALS['kodety_publication_test']['meta'][$post_id][$key]);
    return true;
}

function get_attached_file(int $attachment_id): string {
    return (string) ($GLOBALS['kodety_publication_test']['attachments'][$attachment_id]['file'] ?? '');
}

function update_attached_file(int $attachment_id, string $file): bool {
    $state = &$GLOBALS['kodety_publication_test'];
    if (
        ($state['attachments'][$attachment_id]['title'] ?? '')
        === $state['fail_attached_file_title']
        && $state['fail_attached_file_title'] !== ''
    ) {
        return false;
    }
    $state['attachments'][$attachment_id]['file'] = $file;
    $prefix = trailingslashit($state['upload_root']);
    $state['meta'][$attachment_id]['_wp_attached_file'] = str_starts_with($file, $prefix)
        ? substr($file, strlen($prefix))
        : basename($file);
    return true;
}

function wp_insert_attachment(array $post, string $file, int $parent = 0, bool $wp_error = false): int|WP_Error {
    $state = &$GLOBALS['kodety_publication_test'];
    if (($post['post_title'] ?? '') === $state['fail_attachment_title']) {
        return new WP_Error('attachment_failed', 'falha intermediária simulada');
    }
    $attachment_id = ++$state['next_attachment_id'];
    $state['attachments'][$attachment_id] = [
        'file' => $file,
        'title' => (string) ($post['post_title'] ?? ''),
    ];
    return $attachment_id;
}

function wp_update_post(array $post, bool $wp_error = false): int|WP_Error {
    $state = &$GLOBALS['kodety_publication_test'];
    $post_id = (int) ($post['ID'] ?? 0);
    if (($post['post_type'] ?? '') === 'page') {
        if ($post_id === $state['fail_page_update_id']) {
            return new WP_Error('page_failed', 'falha intermediária simulada');
        }
        if (isset($state['pages'][$post_id])) {
            $state['pages'][$post_id]->post_status = (string) ($post['post_status'] ?? 'publish');
        }
    }
    return $post_id;
}

function wp_insert_post(array $post, bool $wp_error = false): int|WP_Error {
    $state = &$GLOBALS['kodety_publication_test'];
    $post_id = $state['next_page_id']++;
    $state['pages'][$post_id] = new WP_Post($post_id, (string) ($post['post_status'] ?? 'publish'));
    return $post_id;
}

function wp_slash(mixed $value): mixed {
    return $value;
}

function get_post_status(int $post_id): string {
    return $GLOBALS['kodety_publication_test']['pages'][$post_id]->post_status ?? 'draft';
}

function wp_trash_post(int $post_id): WP_Post|false {
    $state = &$GLOBALS['kodety_publication_test'];
    if (!isset($state['pages'][$post_id])) return false;
    if ($state['fail_trash_id'] === $post_id) return false;
    $state['pages'][$post_id]->post_status = 'trash';
    $state['trashed_pages'][] = $post_id;
    return $state['pages'][$post_id];
}

function wp_delete_attachment(int $attachment_id, bool $force_delete = false): WP_Post|false {
    $state = &$GLOBALS['kodety_publication_test'];
    if (!isset($state['attachments'][$attachment_id])) return false;
    $state['deleted_attachments'][] = $attachment_id;
    $file = (string) ($state['attachments'][$attachment_id]['file'] ?? '');
    if ($file !== '' && is_file($file)) @unlink($file);
    unset(
        $state['attachments'][$attachment_id],
        $state['meta'][$attachment_id],
        $state['attachment_metadata'][$attachment_id]
    );
    return new WP_Post($attachment_id, 'trash');
}

function wp_generate_attachment_metadata(int $attachment_id, string $file): array {
    $state = &$GLOBALS['kodety_publication_test'];
    $threshold = apply_filters('big_image_size_threshold', 2560, [3000, 2000], $file, $attachment_id);
    $sizes = apply_filters(
        'intermediate_image_sizes_advanced',
        ['thumbnail' => ['width' => 150, 'height' => 150]],
        ['width' => 3000, 'height' => 2000],
        $attachment_id
    );
    $state['metadata_calls'][] = [
        'attachment_id' => $attachment_id,
        'threshold' => $threshold,
        'sizes' => $sizes,
    ];
    if ($threshold !== false) {
        $extension = pathinfo($file, PATHINFO_EXTENSION);
        $scaled = substr($file, 0, -(strlen($extension) + 1)) . '-scaled.' . $extension;
        file_put_contents($scaled, 'wordpress-scaled-derivative');
        update_attached_file($attachment_id, $scaled);
    }
    return ['width' => 3000, 'height' => 2000, 'sizes' => $sizes];
}

function wp_update_attachment_metadata(int $attachment_id, array $metadata): bool {
    if (($GLOBALS['kodety_publication_test']['attachment_metadata'][$attachment_id] ?? null) === $metadata) {
        return false;
    }
    $GLOBALS['kodety_publication_test']['attachment_metadata'][$attachment_id] = $metadata;
    return true;
}

function wp_get_attachment_metadata(int $attachment_id): array|false {
    return $GLOBALS['kodety_publication_test']['attachment_metadata'][$attachment_id] ?? false;
}

function wp_getimagesize(string $file): array|false {
    return is_file($file) ? [3000, 2000, 'mime' => 'image/png'] : false;
}

function wp_filesize(string $file): int|false {
    return is_file($file) ? filesize($file) : false;
}

function wp_get_attachment_url(int $attachment_id): string|false {
    $relative = (string) get_post_meta($attachment_id, '_wp_attached_file', true);
    return $relative === '' ? false : 'https://example.test/uploads/' . $relative;
}

function wp_next_scheduled(string $hook, array $args = []): int|false {
    foreach ($GLOBALS['kodety_publication_test']['scheduled_events'] as $event) {
        if ($event['hook'] === $hook && $event['args'] === $args) return $event['timestamp'];
    }
    return false;
}

function wp_schedule_single_event(
    int $timestamp,
    string $hook,
    array $args = [],
    bool $wp_error = false
): bool {
    if ($GLOBALS['kodety_publication_test']['schedule_failure']) return false;
    $GLOBALS['kodety_publication_test']['scheduled_events'][] = compact('timestamp', 'hook', 'args');
    return true;
}

function wp_clear_scheduled_hook(string $hook, array $args = []): int {
    $before = count($GLOBALS['kodety_publication_test']['scheduled_events']);
    $GLOBALS['kodety_publication_test']['scheduled_events'] = array_values(array_filter(
        $GLOBALS['kodety_publication_test']['scheduled_events'],
        static fn(array $event): bool => $event['hook'] !== $hook || $event['args'] !== $args
    ));
    return $before - count($GLOBALS['kodety_publication_test']['scheduled_events']);
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_publication_assert(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

function kodety_publication_expect_failure(callable $operation, string $fragment): void {
    try {
        $operation();
    } catch (RuntimeException $error) {
        kodety_publication_assert(
            str_contains($error->getMessage(), $fragment),
            'Falha inesperada: ' . $error->getMessage()
        );
        return;
    }
    throw new RuntimeException('Era esperada uma falha contendo: ' . $fragment);
}

function kodety_publication_remove_tree(string $directory): void {
    if (!is_dir($directory)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
    }
    @rmdir($directory);
}

/** @return array<string,string> Relative path => kind/hash. */
function kodety_publication_tree_snapshot(string $directory): array {
    if (!is_dir($directory)) return [];
    $root = rtrim(str_replace('\\', '/', $directory), '/');
    $snapshot = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($iterator as $item) {
        $path = str_replace('\\', '/', $item->getPathname());
        $relative = ltrim(substr($path, strlen($root)), '/');
        $snapshot[$relative] = $item->isDir()
            ? 'directory'
            : 'file:' . hash_file('sha256', $item->getPathname());
    }
    ksort($snapshot, SORT_STRING);
    return $snapshot;
}

file_put_contents($site_root . '/assets/a.png', 'asset-a');
file_put_contents($site_root . '/assets/b.png', 'asset-b');
file_put_contents(
    $site_root . '/index.html',
    '<!doctype html><img src="assets/a.png"><img src="assets/b.png">'
);
file_put_contents(
    $theme_root . '/manifest.json',
    json_encode(['' => 'index.html', 'about' => 'about.html'], JSON_THROW_ON_ERROR)
);

$plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();
$state = &$GLOBALS['kodety_publication_test'];
$storage_root = $test_root . '/storage';
$storage_property = new ReflectionProperty($plugin, 'storage_dir');
$storage_property->setValue($plugin, $storage_root);

try {
    $intrinsic_route = new ReflectionMethod($plugin, 'intrinsic_project_page_route');
    kodety_publication_assert(
        $intrinsic_route->invoke($plugin, 'encoded/caf%C3%A9.html') === 'encoded/café'
            && $intrinsic_route->invoke($plugin, 'bad/%C3.html') === 'bad/%C3',
        'canonicalização PHP deve espelhar decodeURIComponent sem produzir UTF-8 inválido'
    );
    $route_map = new ReflectionMethod($plugin, 'project_page_route_map');
    $query_collisions = [];
    $query_arguments = [[
            ['route' => 'query?ignored.html', 'relativePath' => 'query?ignored.html'],
            ['route' => 'query/index.html', 'relativePath' => 'query/index.html'],
        ], &$query_collisions];
    $query_routes = $route_map->invokeArgs($plugin, $query_arguments);
    kodety_publication_assert(
        ($query_routes['query'] ?? '') === 'query/index.html'
            && $query_collisions === [[
                'route' => '/query',
                'pagePaths' => ['query/index.html', 'query?ignored.html'],
                'selectedPath' => 'query/index.html',
            ]],
        'query/fragment deve compartilhar a rota do Builder sem bloquear o publish; o último owner vence'
    );
    $fragment_suffix_collisions = [];
    $fragment_suffix_arguments = [[
            ['route' => 'about.html#preview.html', 'relativePath' => 'about.html'],
            ['route' => 'about/index.html', 'relativePath' => 'about/index.html'],
        ], &$fragment_suffix_collisions];
    $fragment_suffix_routes = $route_map->invokeArgs($plugin, $fragment_suffix_arguments);
    kodety_publication_assert(
        ($fragment_suffix_routes['about'] ?? '') === 'about/index.html'
            && $fragment_suffix_collisions === [[
                'route' => '/about',
                'pagePaths' => ['about.html', 'about/index.html'],
                'selectedPath' => 'about/index.html',
            ]],
        'aliases da mesma rota devem escolher owner determinístico e permanecer apenas como warning'
    );

    // Exercise the actual publication/install path. Route ambiguity is
    // diagnostic only: a release must still go online with a deterministic
    // manifest owner and a non-blocking warning.
    $ensure_directories = new ReflectionMethod($plugin, 'ensure_directories');
    $collision_storage_root = $test_root . '/collision-publish-storage';
    $storage_property->setValue($plugin, $collision_storage_root);
    $ensure_directories->invoke($plugin);
    get_temp_dir();
    $collision_zip_path = $test_root . '/route-collision.zip';
    $collision_zip = new ZipArchive();
    kodety_publication_assert(
        $collision_zip->open($collision_zip_path, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true,
        'fixture deve criar ZIP com colisão de rotas'
    );
    $collision_zip->addFromString('index.html', '<!doctype html><title>Home</title>');
    $collision_zip->addFromString('about.html', '<!doctype html><title>About file</title>');
    $collision_zip->addFromString('about/index.html', '<!doctype html><title>About index</title>');
    $collision_zip->close();
    $state_before_collision_publish = $state;
    $sync_report_property = new ReflectionProperty($plugin, 'last_publish_sync_report');
    $sync_report_before_collision_publish = $sync_report_property->getValue($plugin);
    $cron_dispatch_property = new ReflectionProperty($plugin, 'publish_sync_cron_dispatch_pending');
    $cron_dispatch_before_collision_publish = $cron_dispatch_property->getValue($plugin);
    $publish_collision = $plugin->publish_project(new WP_REST_Request(
        ['optimizations' => [
            'minifyHtml' => false,
            'minifyCss' => false,
            'lazyImages' => false,
            'preloadFonts' => false,
            'deferScripts' => false,
        ]],
        ['x-kodety-expected-revision' => (string) get_option('kodety_workspace_revision', 0)],
        (string) file_get_contents($collision_zip_path)
    ));
    $publish_collision_data = is_wp_error($publish_collision) ? [] : $publish_collision->get_data();
    $published_collision_manifest = !is_wp_error($publish_collision)
        ? json_decode((string) file_get_contents($state['theme_root'] . '/manifest.json'), true)
        : null;
    kodety_publication_assert(
        !is_wp_error($publish_collision)
            && in_array($publish_collision->get_status(), [200, 202], true)
            && !empty($publish_collision_data['releaseOnline'])
            && ($published_collision_manifest['about'] ?? '') === 'about/index.html'
            && str_contains(implode(' ', (array) ($publish_collision_data['warnings'] ?? [])), '/about')
            && str_contains(implode(' ', (array) ($publish_collision_data['warnings'] ?? [])), 'about/index.html'),
        'alias de rota nunca deve bloquear publish; release deve ficar online com owner e warning determinísticos'
    );
    // Keep the remaining native-sync fault matrix isolated from this complete
    // release transaction; its own fixtures intentionally start at release-next.
    $state = $state_before_collision_publish;
    $storage_property->setValue($plugin, $storage_root);
    $sync_report_property->setValue($plugin, $sync_report_before_collision_publish);
    $cron_dispatch_property->setValue($plugin, $cron_dispatch_before_collision_publish);

    // A revision-keyed download ZIP is not publication authority. Prove the
    // complete Builder boundary with a non-CSS/HTML edit: delta ACK, destination
    // cache invalidation, immediate Publish and exact bytes in theme/workspace.
    $state_before_workspace_publish = $state;
    $workspace_publish_storage = $test_root . '/workspace-publish-storage';
    $workspace_publish_workspace = $workspace_publish_storage . '/private/workspace';
    wp_mkdir_p($workspace_publish_workspace . '/.incode');
    wp_mkdir_p($workspace_publish_workspace . '/assets');
    $workspace_publish_html = '<!doctype html><html><head><title>Workspace publish</title></head><body>same</body></html>';
    $workspace_publish_old_script = 'window.__kodetyRevision = "OLD";';
    $workspace_publish_new_script = 'window.__kodetyRevision = "NEW";';
    $workspace_publish_metadata = json_encode([
        'version' => 1,
        'name' => 'Workspace Publish',
        'projectId' => 'workspace-publish',
        'mainHtmlPath' => 'index.html',
    ], JSON_THROW_ON_ERROR);
    file_put_contents($workspace_publish_workspace . '/index.html', $workspace_publish_html);
    file_put_contents($workspace_publish_workspace . '/assets/app.js', $workspace_publish_old_script);
    file_put_contents($workspace_publish_workspace . '/.incode/project.json', $workspace_publish_metadata);

    $workspace_publish_plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();
    $storage_property->setValue($workspace_publish_plugin, $workspace_publish_storage);
    (new ReflectionMethod($workspace_publish_plugin, 'ensure_directories'))->invoke($workspace_publish_plugin);
    $workspace_publish_digest_method = new ReflectionMethod(
        $workspace_publish_plugin,
        'css_digest_from_directory'
    );
    $workspace_publish_digest = $workspace_publish_digest_method->invoke(
        $workspace_publish_plugin,
        $workspace_publish_workspace
    );
    $state['options'] = [
        'kodety_current_release' => 'workspace-publish-base',
        'kodety_workspace_revision' => 40,
        'kodety_workspace_css_digest' => $workspace_publish_digest,
        'kodety_project_name' => 'Workspace Publish',
        'kodety_workspace_project_id' => 'workspace-publish',
    ];
    $state['fail_attachment_title'] = '';
    $state['fail_page_update_id'] = 0;
    $state['fail_new_page_meta_key'] = '';
    $state['fail_option_key'] = '';
    $state['schedule_failure'] = false;

    $workspace_publish_template_digest = (new ReflectionMethod(
        $workspace_publish_plugin,
        'project_template_state_digest'
    ))->invoke($workspace_publish_plugin);
    $workspace_publish_cache_path = (new ReflectionMethod(
        $workspace_publish_plugin,
        'project_zip_cache_path'
    ))->invoke($workspace_publish_plugin, 41, $workspace_publish_template_digest);
    $write_stale_workspace_publish_cache = static function () use (
        $workspace_publish_cache_path,
        $workspace_publish_html,
        $workspace_publish_old_script,
        $workspace_publish_metadata
    ): void {
        wp_mkdir_p(dirname($workspace_publish_cache_path));
        $cache = new ZipArchive();
        if ($cache->open($workspace_publish_cache_path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('fixture não conseguiu criar cache ZIP obsoleto');
        }
        $cache->addFromString('index.html', $workspace_publish_html);
        $cache->addFromString('assets/app.js', $workspace_publish_old_script);
        $cache->addFromString('.incode/project.json', $workspace_publish_metadata);
        $cache->close();
    };
    $write_stale_workspace_publish_cache();

    $workspace_publish_next_metadata = json_encode([
        'version' => 1,
        'name' => 'Workspace Publish',
        'projectId' => 'workspace-publish',
        'mainHtmlPath' => 'index.html',
        'updatedAt' => '2026-09-01T12:00:00Z',
    ], JSON_THROW_ON_ERROR);
    $workspace_publish_delta_body = json_encode([
        'protocolVersion' => 1,
        'baseRevision' => 40,
        'baseDigest' => $workspace_publish_digest,
        'requestId' => 'draft-delta-workspace-publish-01',
        'upserts' => [
            [
                'path' => 'assets/app.js',
                'encoding' => 'utf8',
                'content' => $workspace_publish_new_script,
                'byteLength' => strlen($workspace_publish_new_script),
                'sha256' => hash('sha256', $workspace_publish_new_script),
            ],
            [
                'path' => '.incode/project.json',
                'encoding' => 'utf8',
                'content' => $workspace_publish_next_metadata,
                'byteLength' => strlen($workspace_publish_next_metadata),
                'sha256' => hash('sha256', $workspace_publish_next_metadata),
            ],
        ],
        'deletes' => [],
        'moves' => [],
    ], JSON_THROW_ON_ERROR);
    $workspace_publish_delta = $workspace_publish_plugin->save_project_draft_delta(new WP_REST_Request(
        [],
        ['x-kodety-expected-revision' => '40'],
        $workspace_publish_delta_body
    ));
    $workspace_publish_delta_data = is_wp_error($workspace_publish_delta)
        ? []
        : $workspace_publish_delta->get_data();
    kodety_publication_assert(
        !is_wp_error($workspace_publish_delta)
            && ($workspace_publish_delta_data['success'] ?? false) === true
            && ($workspace_publish_delta_data['workspaceRevision'] ?? null) === 41
            && ($workspace_publish_delta_data['cssDigest'] ?? '') === $workspace_publish_digest
            && file_get_contents($workspace_publish_workspace . '/assets/app.js')
                === $workspace_publish_new_script,
        'delta de arquivo arbitrário deve confirmar revisão e bytes exatos no workspace'
    );
    kodety_publication_assert(
        !is_file($workspace_publish_cache_path),
        'commit delta deve invalidar cache ZIP pré-existente da revisão destino'
    );

    // Reintroduce a same-revision cache to prove Publish itself remains correct
    // even after an external disk/database restore or cache race.
    $write_stale_workspace_publish_cache();
    $workspace_publish = $workspace_publish_plugin->publish_project(new WP_REST_Request(
        ['optimizations' => [
            'minifyHtml' => false,
            'minifyCss' => false,
            'lazyImages' => false,
            'preloadFonts' => false,
            'deferScripts' => false,
        ]],
        [
            'x-kodety-publish-workspace' => '1',
            'x-kodety-expected-revision' => '41',
            'x-kodety-css-digest' => $workspace_publish_digest,
            'x-kodety-publish-request-id' => 'publish-workspace-cache-01',
        ],
        '{}'
    ));
    $workspace_publish_data = is_wp_error($workspace_publish) ? [] : $workspace_publish->get_data();
    $workspace_publish_theme_script = get_theme_root() . '/kodety-generated/site/assets/app.js';
    kodety_publication_assert(
        !is_wp_error($workspace_publish)
            && in_array($workspace_publish->get_status(), [200, 202], true)
            && ($workspace_publish_data['success'] ?? false) === true
            && !empty($workspace_publish_data['releaseOnline'])
            && ($workspace_publish_data['workspaceRevision'] ?? null) === 41
            && (int) get_option('kodety_workspace_revision') === 41
            && is_file($workspace_publish_theme_script)
            && file_get_contents($workspace_publish_theme_script) === $workspace_publish_new_script
            && file_get_contents($workspace_publish_workspace . '/assets/app.js')
                === $workspace_publish_new_script,
        'publish imediato deve instalar o arquivo ACKado, nunca o ZIP obsoleto de download'
    );

    // The negotiated compatibility ZIP must receive the same end-to-end
    // guarantees as delta: exact full-tree ACK, revision cache replacement and
    // immediate publication of that acknowledged workspace.
    $fallback_zip_path = $test_root . '/workspace-fallback-r42.zip';
    $fallback_html = '<!doctype html><html><head><title>ZIP NEW</title></head><body class="visible">ZIP NEW</body></html>';
    $fallback_css = '.visible{display:block;visibility:visible}';
    $fallback_script = 'window.__kodetyRevision = "ZIP-NEW";';
    $fallback_metadata = json_encode([
        'version' => 1,
        'name' => 'Workspace Publish',
        'projectId' => 'workspace-publish',
        'mainHtmlPath' => 'index.html',
        'updatedAt' => '2026-09-01T13:00:00Z',
    ], JSON_THROW_ON_ERROR);
    $fallback_zip = new ZipArchive();
    kodety_publication_assert(
        $fallback_zip->open($fallback_zip_path, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true,
        'fixture deve criar ZIP completo do fallback'
    );
    $fallback_zip->addFromString('index.html', $fallback_html);
    $fallback_zip->addFromString('styles.css', $fallback_css);
    $fallback_zip->addFromString('assets/app.js', $fallback_script);
    $fallback_zip->addFromString('.incode/project.json', $fallback_metadata);
    $fallback_zip->close();
    $project_digest_from_zip = new ReflectionMethod($workspace_publish_plugin, 'project_digest_from_zip');
    $golden_digest_zip_path = $test_root . '/project-digest-golden.zip';
    $golden_digest_zip = new ZipArchive();
    $golden_digest_zip->open($golden_digest_zip_path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    $golden_digest_zip->addFromString('index.html', '<main>new</main>');
    $golden_digest_zip->addFromString('app.js', 'window.x=1;');
    $golden_digest_zip->close();
    kodety_publication_assert(
        $project_digest_from_zip->invoke($workspace_publish_plugin, $golden_digest_zip_path)
            === '4b48cbaa042697043b1c9d2d4b113109bfce0a27a2df58bc7f7cc13d8fd2705c',
        'digest integral PHP deve usar o mesmo framing canônico do Builder'
    );
    $fallback_project_digest = $project_digest_from_zip->invoke($workspace_publish_plugin, $fallback_zip_path);
    $fallback_css_digest = (new ReflectionMethod(
        $workspace_publish_plugin,
        'css_digest_from_zip'
    ))->invoke($workspace_publish_plugin, $fallback_zip_path);
    $fallback_save = $workspace_publish_plugin->save_project_draft(new WP_REST_Request(
        [],
        [
            'x-kodety-expected-revision' => '41',
            'x-kodety-project-digest' => $fallback_project_digest,
        ],
        (string) file_get_contents($fallback_zip_path)
    ));
    $fallback_save_data = is_wp_error($fallback_save) ? [] : $fallback_save->get_data();
    kodety_publication_assert(
        !is_wp_error($fallback_save)
            && ($fallback_save_data['success'] ?? false) === true
            && ($fallback_save_data['workspaceRevision'] ?? null) === 42
            && ($fallback_save_data['projectDigest'] ?? '') === $fallback_project_digest
            && file_get_contents($workspace_publish_workspace . '/index.html') === $fallback_html
            && file_get_contents($workspace_publish_workspace . '/styles.css') === $fallback_css
            && file_get_contents($workspace_publish_workspace . '/assets/app.js') === $fallback_script,
        'fallback ZIP deve ACKar e ativar exatamente HTML, CSS, JS e metadados da revisão atual'
    );

    $omitted_zip_path = $test_root . '/workspace-fallback-omitted.zip';
    $omitted_zip = new ZipArchive();
    $omitted_zip->open($omitted_zip_path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    $omitted_zip->addFromString('index.html', $fallback_html);
    $omitted_zip->addFromString('styles.css', $fallback_css);
    $omitted_zip->addFromString('assets/app.js', $fallback_script);
    $omitted_zip->addFromString('custom.xyz', 'must-not-disappear');
    $omitted_zip->addFromString('.incode/project.json', $fallback_metadata);
    $omitted_zip->close();
    $omitted_project_digest = $project_digest_from_zip->invoke($workspace_publish_plugin, $omitted_zip_path);
    $omitted_save = $workspace_publish_plugin->save_project_draft(new WP_REST_Request(
        [],
        [
            'x-kodety-expected-revision' => '42',
            'x-kodety-project-digest' => $omitted_project_digest,
        ],
        (string) file_get_contents($omitted_zip_path)
    ));
    kodety_publication_assert(
        is_wp_error($omitted_save)
            && (int) get_option('kodety_workspace_revision') === 42
            && file_get_contents($workspace_publish_workspace . '/assets/app.js') === $fallback_script,
        'fallback ZIP nunca deve confirmar uma árvore da qual a extração omitiu arquivos'
    );

    $fallback_publish = $workspace_publish_plugin->publish_project(new WP_REST_Request(
        ['optimizations' => [
            'minifyHtml' => false,
            'minifyCss' => false,
            'lazyImages' => false,
            'preloadFonts' => false,
            'deferScripts' => false,
        ]],
        [
            'x-kodety-publish-workspace' => '1',
            'x-kodety-expected-revision' => '42',
            'x-kodety-css-digest' => $fallback_css_digest,
            'x-kodety-publish-request-id' => 'publish-workspace-fallback-zip-01',
        ],
        '{}'
    ));
    $fallback_theme = get_theme_root() . '/kodety-generated/site';
    $fallback_published_html = is_file($fallback_theme . '/index.html')
        ? (string) file_get_contents($fallback_theme . '/index.html')
        : '';
    kodety_publication_assert(
        !is_wp_error($fallback_publish)
            && in_array($fallback_publish->get_status(), [200, 202], true)
            && str_contains($fallback_published_html, 'ZIP NEW')
            && str_contains($fallback_published_html, 'class="visible"')
            && file_get_contents($fallback_theme . '/styles.css') === $fallback_css
            && file_get_contents($fallback_theme . '/assets/app.js') === $fallback_script,
        'publish após fallback ZIP deve instalar a revisão ACKada completa, sem conteúdo antigo'
    );

    // "Criar novo" is a destructive workspace replacement, not an edit of the
    // previous project. Prove the complete backend boundary independently of
    // the browser transport decision: A has an asset, blank B has a new
    // projectId and no assets, and Publish immediately installs only B.
    $blank_replacement_zip_path = $test_root . '/workspace-blank-replacement-r43.zip';
    $blank_replacement_html = '<!doctype html><html lang="pt-BR"><head><title>Meu site</title>'
        . '<link rel="stylesheet" href="styles.css"></head><body><main data-blank-project="true"></main>'
        . '<script src="script.js"></script></body></html>';
    $blank_replacement_css = 'html,body{margin:0;min-height:100%}';
    $blank_replacement_project_id = 'blank-project-b';
    $blank_replacement_metadata = json_encode([
        'version' => 1,
        'name' => 'Meu site',
        'projectId' => $blank_replacement_project_id,
        'mainHtmlPath' => 'index.html',
        'homeHtmlPath' => 'index.html',
        'rootPath' => '',
    ], JSON_THROW_ON_ERROR);
    $blank_replacement_zip = new ZipArchive();
    kodety_publication_assert(
        $blank_replacement_zip->open(
            $blank_replacement_zip_path,
            ZipArchive::CREATE | ZipArchive::OVERWRITE
        ) === true,
        'fixture deve criar o ZIP completo do projeto B vazio'
    );
    $blank_replacement_zip->addFromString('index.html', $blank_replacement_html);
    $blank_replacement_zip->addFromString('styles.css', $blank_replacement_css);
    $blank_replacement_zip->addFromString('script.js', '');
    $blank_replacement_zip->addFromString('.incode/project.json', $blank_replacement_metadata);
    $blank_replacement_zip->close();
    $blank_replacement_project_digest = $project_digest_from_zip->invoke(
        $workspace_publish_plugin,
        $blank_replacement_zip_path
    );
    $blank_replacement_save = $workspace_publish_plugin->save_project_draft(new WP_REST_Request(
        [],
        [
            'x-kodety-expected-revision' => '42',
            'x-kodety-project-digest' => $blank_replacement_project_digest,
        ],
        (string) file_get_contents($blank_replacement_zip_path)
    ));
    $blank_replacement_save_data = is_wp_error($blank_replacement_save)
        ? []
        : $blank_replacement_save->get_data();
    $blank_replacement_digest = (string) ($blank_replacement_save_data['cssDigest'] ?? '');
    kodety_publication_assert(
        !is_wp_error($blank_replacement_save)
            && ($blank_replacement_save_data['success'] ?? false) === true
            && ($blank_replacement_save_data['workspaceRevision'] ?? null) === 43
            && ($blank_replacement_save_data['projectId'] ?? '') === $blank_replacement_project_id
            && ($blank_replacement_save_data['projectDigest'] ?? '') === $blank_replacement_project_digest
            && (string) get_option('kodety_workspace_project_id') === $blank_replacement_project_id
            && file_get_contents($workspace_publish_workspace . '/index.html') === $blank_replacement_html
            && !is_file($workspace_publish_workspace . '/assets/app.js'),
        'substituição completa A→blank B deve ACKar a nova identidade e remover assets de A: '
            . (is_wp_error($blank_replacement_save)
                ? $blank_replacement_save->get_error_code() . ' — ' . $blank_replacement_save->get_error_message()
                : json_encode($blank_replacement_save_data))
    );

    $blank_replacement_publish = $workspace_publish_plugin->publish_project(new WP_REST_Request(
        ['optimizations' => [
            'minifyHtml' => false,
            'minifyCss' => false,
            'lazyImages' => false,
            'preloadFonts' => false,
            'deferScripts' => false,
        ]],
        [
            'x-kodety-publish-workspace' => '1',
            'x-kodety-expected-revision' => '43',
            'x-kodety-css-digest' => $blank_replacement_digest,
            'x-kodety-publish-request-id' => 'publish-blank-replacement-01',
        ],
        '{}'
    ));
    $blank_replacement_publish_data = is_wp_error($blank_replacement_publish)
        ? []
        : $blank_replacement_publish->get_data();
    $blank_replacement_theme = get_theme_root() . '/kodety-generated/site';
    kodety_publication_assert(
        !is_wp_error($blank_replacement_publish)
            && in_array($blank_replacement_publish->get_status(), [200, 202], true)
            && ($blank_replacement_publish_data['success'] ?? false) === true
            && !empty($blank_replacement_publish_data['releaseOnline'])
            && ($blank_replacement_publish_data['workspaceRevision'] ?? null) === 43
            && (int) get_option('kodety_workspace_revision') === 43
            && (string) get_option('kodety_workspace_project_id') === $blank_replacement_project_id
            && (string) get_option('kodety_published_project_id') === $blank_replacement_project_id
            && str_contains(
                (string) file_get_contents($blank_replacement_theme . '/index.html'),
                'data-blank-project="true"'
            )
            && !is_file($blank_replacement_theme . '/assets/app.js')
            && !is_file($workspace_publish_workspace . '/assets/app.js'),
        'publish imediato de blank B deve manter revisão/identidade e nunca ressuscitar assets de A: '
            . (is_wp_error($blank_replacement_publish)
                ? $blank_replacement_publish->get_error_code() . ' — ' . $blank_replacement_publish->get_error_message()
                : json_encode($blank_replacement_publish_data))
    );
    $state = $state_before_workspace_publish;
    $storage_property->setValue($plugin, $storage_root);

    // A publish chosen by the user must not be held hostage by a stale draft
    // CAS. The complete snapshot is self-contained, so it can activate while
    // the newer editable workspace remains untouched for later reconciliation.
    $state_before_snapshot_publish = $state;
    $sync_report_before_snapshot_publish = $sync_report_property->getValue($plugin);
    $cron_dispatch_before_snapshot_publish = $cron_dispatch_property->getValue($plugin);
    $snapshot_storage_root = $test_root . '/conflicting-snapshot-publish-storage';
    $snapshot_upload_root = $test_root . '/conflicting-snapshot-publish-uploads';
    $snapshot_previous_theme = $test_root . '/conflicting-snapshot-previous-theme';
    wp_mkdir_p($snapshot_previous_theme . '/site');
    wp_mkdir_p($snapshot_upload_root);
    $state['upload_root'] = $snapshot_upload_root;
    $state['theme_root'] = $snapshot_previous_theme;
    $state['active_theme'] = 'snapshot-previous-theme';
    $state['scheduled_events'] = [];
    $state['actions'] = [];
    $state['cache_purges'] = 0;
    $state['schedule_failure'] = false;
    $state['fail_option_key'] = '';
    $state['runtime_fault_checkpoint'] = '';
    $state['runtime_fault_file'] = '';
    $state['options']['kodety_current_release'] = 'snapshot-previous-release';
    $state['options']['kodety_workspace_revision'] = 42;
    $state['options']['kodety_workspace_project_id'] = 'project-snapshot-conflict';
    $state['options']['kodety_published_project_id'] = 'project-snapshot-conflict';
    $state['options']['kodety_default_pages_cleaned'] = true;
    $storage_property->setValue($plugin, $snapshot_storage_root);
    $ensure_directories->invoke($plugin);

    $conflicting_workspace = $snapshot_storage_root . '/private/workspace';
    wp_mkdir_p($conflicting_workspace . '/.incode');
    $remote_html = '<!doctype html><html><head><title>REMOTE</title></head><body><h1>REMOTE</h1></body></html>';
    file_put_contents($conflicting_workspace . '/index.html', $remote_html);
    file_put_contents($conflicting_workspace . '/style.css', 'body{color:purple}');
    file_put_contents($conflicting_workspace . '/assets-remote.txt', 'REMOTE-ASSET');
    file_put_contents($conflicting_workspace . '/.incode/project.json', json_encode([
        'version' => 1,
        'projectId' => 'project-snapshot-conflict',
        'name' => 'Remote workspace',
        'mainHtmlPath' => 'index.html',
        'homeHtmlPath' => 'index.html',
    ], JSON_THROW_ON_ERROR));
    $snapshot_css_digest_from_directory = new ReflectionMethod($plugin, 'css_digest_from_directory');
    $remote_workspace_digest = $snapshot_css_digest_from_directory->invoke($plugin, $conflicting_workspace);
    $state['options']['kodety_workspace_css_digest'] = $remote_workspace_digest;
    $remote_workspace_tree = kodety_publication_tree_snapshot($conflicting_workspace);

    $selected_snapshot_zip_path = $test_root . '/selected-conflicting-snapshot.zip';
    $selected_snapshot_zip = new ZipArchive();
    kodety_publication_assert(
        $selected_snapshot_zip->open(
            $selected_snapshot_zip_path,
            ZipArchive::CREATE | ZipArchive::OVERWRITE
        ) === true,
        'fixture deve criar o ZIP completo do snapshot selecionado'
    );
    $selected_html = '<!doctype html><html><head><title>SELECTED</title></head><body><h1>SELECTED</h1></body></html>';
    $selected_snapshot_zip->addFromString('index.html', $selected_html);
    $selected_snapshot_zip->addFromString('style.css', 'body{color:blue}');
    $selected_snapshot_zip->addFromString('assets-selected.txt', 'SELECTED-ASSET');
    $selected_snapshot_zip->addFromString('.incode/project.json', json_encode([
        'version' => 1,
        'projectId' => 'project-snapshot-conflict',
        'name' => 'Selected snapshot',
        'mainHtmlPath' => 'index.html',
        'homeHtmlPath' => 'index.html',
    ], JSON_THROW_ON_ERROR));
    $selected_snapshot_zip->close();
    $snapshot_css_digest_from_zip = new ReflectionMethod($plugin, 'css_digest_from_zip');
    $selected_snapshot_digest = $snapshot_css_digest_from_zip->invoke($plugin, $selected_snapshot_zip_path);
    $stale_source_digest = str_repeat('0', 64);
    kodety_publication_assert(
        $stale_source_digest !== $remote_workspace_digest,
        'fixture deve usar source digest deliberadamente conflitante'
    );

    $snapshot_release_before = get_option('kodety_current_release');
    $stale_snapshot_publish = $plugin->publish_project(new WP_REST_Request(
        [],
        [
            'x-kodety-publish-materialized' => '1',
            'x-kodety-publish-snapshot' => '1',
            'x-kodety-expected-revision' => '41',
            'x-kodety-css-digest' => $selected_snapshot_digest,
            'x-kodety-workspace-project-id' => 'project-snapshot-conflict',
        ],
        (string) file_get_contents($selected_snapshot_zip_path)
    ));
    kodety_publication_assert(
        is_wp_error($stale_snapshot_publish) && $stale_snapshot_publish->get_error_code() === 'kodety_workspace_conflict'
            && $stale_snapshot_publish->get_error_data()['status'] === 409
            && get_option('kodety_current_release') === $snapshot_release_before
            && kodety_publication_tree_snapshot($conflicting_workspace) === $remote_workspace_tree,
        'snapshot com revisão antiga não pode contornar conflito nem publicar por cima das alterações concorrentes'
    );
    $snapshot_publish = $plugin->publish_project(new WP_REST_Request(
        ['optimizations' => [
            'minifyHtml' => false,
            'minifyCss' => false,
            'lazyImages' => false,
            'preloadFonts' => false,
            'deferScripts' => false,
        ]],
        [
            'x-kodety-publish-materialized' => '1',
            'x-kodety-publish-snapshot' => '1',
            'x-kodety-expected-revision' => '42',
            'x-kodety-css-digest' => $selected_snapshot_digest,
            'x-kodety-source-css-digest' => $stale_source_digest,
            'x-kodety-workspace-project-id' => 'project-snapshot-conflict',
            'x-kodety-publish-request-id' => 'publish-snapshot-conflict-fixture',
        ],
        (string) file_get_contents($selected_snapshot_zip_path)
    ));
    $snapshot_publish_data = is_wp_error($snapshot_publish) ? [] : $snapshot_publish->get_data();
    $snapshot_warning = implode(' ', (array) ($snapshot_publish_data['warnings'] ?? []));
    $published_snapshot_html = !is_wp_error($snapshot_publish)
        ? (string) file_get_contents($state['theme_root'] . '/site/index.html')
        : '';
    kodety_publication_assert(
        !is_wp_error($snapshot_publish)
            && in_array($snapshot_publish->get_status(), [200, 202], true)
            && !empty($snapshot_publish_data['releaseOnline'])
            && str_contains($published_snapshot_html, 'SELECTED')
            && !str_contains($published_snapshot_html, 'REMOTE')
            && str_contains($snapshot_warning, 'reconciliação'),
        'snapshot explicitamente selecionado com revisão atual pode publicar e informar reconciliação pendente: '
            . (is_wp_error($snapshot_publish)
                ? $snapshot_publish->get_error_code() . ' — ' . $snapshot_publish->get_error_message()
                : 'status=' . $snapshot_publish->get_status()
                    . '; payload=' . json_encode($snapshot_publish_data)
                    . '; html=' . $published_snapshot_html)
    );
    kodety_publication_assert(
        kodety_publication_tree_snapshot($conflicting_workspace) === $remote_workspace_tree
            && file_get_contents($conflicting_workspace . '/index.html') === $remote_html
            && (int) get_option('kodety_workspace_revision') === 42
            && get_option('kodety_workspace_css_digest') === $remote_workspace_digest,
        'publish snapshot deve preservar workspace remoto, revisão e digest byte por byte'
    );
    $published_snapshot_release = (string) get_option('kodety_current_release');
    $state['options']['kodety_workspace_project_id'] = 'another-active-project';
    $wrong_project_snapshot_publish = $plugin->publish_project(new WP_REST_Request(
        ['optimizations' => []],
        [
            'x-kodety-publish-materialized' => '1',
            'x-kodety-publish-snapshot' => '1',
            'x-kodety-expected-revision' => '42',
            'x-kodety-css-digest' => $selected_snapshot_digest,
            'x-kodety-workspace-project-id' => 'project-snapshot-conflict',
            'x-kodety-publish-request-id' => 'publish-snapshot-wrong-project-fixture',
        ],
        (string) file_get_contents($selected_snapshot_zip_path)
    ));
    kodety_publication_assert(
        is_wp_error($wrong_project_snapshot_publish)
            && $wrong_project_snapshot_publish->get_error_code() === 'kodety_publish_snapshot_project_changed'
            && (string) get_option('kodety_current_release') === $published_snapshot_release,
        'snapshot resiliente nunca deve atravessar a identidade de outro projeto ativo'
    );
    $state['options']['kodety_workspace_project_id'] = 'project-snapshot-conflict';

    // Restore every shared fixture surface before continuing the native-sync
    // fault matrix below.
    $state = $state_before_snapshot_publish;
    $storage_property->setValue($plugin, $storage_root);
    $sync_report_property->setValue($plugin, $sync_report_before_snapshot_publish);
    $cron_dispatch_property->setValue($plugin, $cron_dispatch_before_snapshot_publish);

    // A materialized release contains only compiler changes. The server must
    // apply them to a disposable ZIP of the exact acknowledged workspace,
    // preserving large unchanged media and protected authoring metadata.
    $overlay_base = $test_root . '/materialized-base.zip';
    $overlay_patch = $test_root . '/materialized-overlay.zip';
    $base_zip = new ZipArchive();
    kodety_publication_assert(
        $base_zip->open($overlay_base, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true,
        'fixture deve criar o ZIP base materializado'
    );
    $base_zip->addFromString('index.html', '<!doctype html><title>Editable</title>');
    $base_zip->addFromString('style.css', 'body{color:black}');
    $base_zip->addFromString('assets/unchanged.mp4', str_repeat('media-', 4096));
    $base_zip->addFromString('assets/remove-me.js', 'window.removeMe=true');
    $base_zip->addFromString('.incode/project.json', '{"version":1,"name":"Editable"}');
    $base_zip->addFromString('.incode/template.json', '{"schemaVersion":1,"kind":"kodety-project-template"}');
    $base_zip->close();

    $overlay_files = [
        'index.html' => '<!doctype html><title>Published</title><script src="assets/kodety-cookie.js"></script>',
        'assets/kodety-cookie.js' => 'window.kodetyConsent=true',
        'assets/kodety-cookie.css' => '.cc-banner{background:#171719}',
    ];
    $overlay_manifest = [
        'schemaVersion' => 1,
        'kind' => 'kodety-materialized-publish-overlay',
        'upserts' => array_map(
            static fn(string $path, string $contents): array => [
                'path' => $path,
                'byteLength' => strlen($contents),
                'sha256' => hash('sha256', $contents),
            ],
            array_keys($overlay_files),
            array_values($overlay_files)
        ),
        'deletes' => ['assets/remove-me.js'],
    ];
    $patch_zip = new ZipArchive();
    kodety_publication_assert(
        $patch_zip->open($overlay_patch, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true,
        'fixture deve criar o overlay materializado'
    );
    foreach ($overlay_files as $path => $contents) $patch_zip->addFromString($path, $contents);
    $patch_zip->addFromString('.incode/publish-overlay.json', json_encode($overlay_manifest, JSON_THROW_ON_ERROR));
    $patch_zip->close();

    $apply_publish_overlay = new ReflectionMethod($plugin, 'apply_materialized_publish_overlay_to_zip');
    $apply_publish_overlay->invoke($plugin, $overlay_base, $overlay_patch);
    $materialized_zip = new ZipArchive();
    kodety_publication_assert(
        $materialized_zip->open($overlay_base) === true,
        'ZIP reconstruído deve permanecer válido'
    );
    kodety_publication_assert(
        $materialized_zip->getFromName('index.html') === $overlay_files['index.html']
            && $materialized_zip->getFromName('assets/kodety-cookie.js') === $overlay_files['assets/kodety-cookie.js']
            && $materialized_zip->getFromName('assets/kodety-cookie.css') === $overlay_files['assets/kodety-cookie.css'],
        'overlay deve aplicar todos os arquivos materializados'
    );
    kodety_publication_assert(
        $materialized_zip->getFromName('assets/unchanged.mp4') === str_repeat('media-', 4096)
            && $materialized_zip->getFromName('.incode/project.json') === '{"version":1,"name":"Editable"}'
            && $materialized_zip->getFromName('.incode/template.json') === '{"schemaVersion":1,"kind":"kodety-project-template"}',
        'overlay deve preservar mídia e metadados server-side byte por byte'
    );
    kodety_publication_assert(
        $materialized_zip->getFromName('assets/remove-me.js') === false
            && $materialized_zip->getFromName('.incode/publish-overlay.json') === false,
        'overlay deve aplicar exclusões sem vazar seu manifesto para a release'
    );
    $materialized_zip->close();

    $invalid_overlay = $test_root . '/materialized-overlay-invalid.zip';
    $invalid_contents = '{"version":999}';
    $invalid_manifest = [
        'schemaVersion' => 1,
        'kind' => 'kodety-materialized-publish-overlay',
        'upserts' => [[
            'path' => '.incode/project.json',
            'byteLength' => strlen($invalid_contents),
            'sha256' => hash('sha256', $invalid_contents),
        ]],
        'deletes' => [],
    ];
    $invalid_zip = new ZipArchive();
    $invalid_zip->open($invalid_overlay, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    $invalid_zip->addFromString('.incode/project.json', $invalid_contents);
    $invalid_zip->addFromString('.incode/publish-overlay.json', json_encode($invalid_manifest, JSON_THROW_ON_ERROR));
    $invalid_zip->close();
    kodety_publication_expect_failure(
        static fn() => $apply_publish_overlay->invoke($plugin, $overlay_base, $invalid_overlay),
        'metadados protegidos'
    );

    $draft_project = $test_root . '/draft-project';
    mkdir($draft_project . '/.incode', 0777, true);
    file_put_contents($draft_project . '/index.html', '<!doctype html><title>Home</title>');
    file_put_contents($draft_project . '/about.html', '<!doctype html><title>About</title>');
    file_put_contents($draft_project . '/.incode/project.json', json_encode([
        'version' => 1,
        'mainHtmlPath' => 'index.html',
        'homeHtmlPath' => 'index.html',
        'pageStatuses' => ['about.html' => 'draft'],
    ], JSON_THROW_ON_ERROR));
    $draft_page_paths = new ReflectionMethod($plugin, 'project_draft_page_paths');
    kodety_publication_assert(
        $draft_page_paths->invoke($plugin, $draft_project) === ['about.html' => true],
        'a publicação deve reconhecer somente páginas explicitamente marcadas como Draft'
    );
    $draft_public = $test_root . '/draft-public';
    mkdir($draft_public, 0777, true);
    copy($draft_project . '/index.html', $draft_public . '/index.html');
    $css_digest_from_directory = new ReflectionMethod($plugin, 'css_digest_from_directory');
    kodety_publication_assert(
        $css_digest_from_directory->invoke(
            $plugin,
            $draft_project,
            false,
            ['about.html' => true]
        ) === $css_digest_from_directory->invoke($plugin, $draft_public),
        'a validação pública deve excluir do digest as páginas Draft removidas do tema'
    );
    kodety_publication_assert(
        $css_digest_from_directory->invoke($plugin, $draft_project, false)
            !== $css_digest_from_directory->invoke($plugin, $draft_public),
        'o teste precisa provar que uma página Draft alteraria o digest sem a exclusão explícita'
    );
    file_put_contents($draft_project . '/.incode/project.json', json_encode([
        'version' => 1,
        'mainHtmlPath' => 'index.html',
        'homeHtmlPath' => 'index.html',
        'pageStatuses' => ['index.html' => 'draft'],
    ], JSON_THROW_ON_ERROR));
    kodety_publication_expect_failure(
        static fn() => $draft_page_paths->invoke($plugin, $draft_project),
        'página inicial está marcada como Draft'
    );

    $remember_receipt = new ReflectionMethod($plugin, 'remember_publish_receipt');
    $read_receipt = new ReflectionMethod($plugin, 'publish_receipt');
    $receipt_previous_release = (string) get_option('kodety_current_release', '');
    update_option('kodety_current_release', 'release-idempotent', false);
    $receipt_result = [
        'release' => 'release-idempotent',
        'next_revision' => 8,
        'theme_stylesheet' => (string) wp_get_theme()->get_stylesheet(),
    ];
    $remember_receipt->invoke($plugin, 'publish-idempotent-request', 'fingerprint-a', $receipt_result);
    kodety_publication_assert(
        $read_receipt->invoke($plugin, 'publish-idempotent-request', 'fingerprint-a') === $receipt_result,
        'retry idempotente deve recuperar exatamente a release já confirmada'
    );
    kodety_publication_assert(
        $read_receipt->invoke($plugin, 'publish-idempotent-request', 'fingerprint-b') === null,
        'um request id reutilizado com outro pacote nunca pode repetir recibo alheio'
    );
    update_option('kodety_current_release', 'release-newer', false);
    kodety_publication_assert(
        $read_receipt->invoke($plugin, 'publish-idempotent-request', 'fingerprint-a') === null,
        'recibo de uma release já substituída nunca pode responder sucesso enquanto o site continua antigo'
    );
    update_option('kodety_current_release', $receipt_previous_release, false);

    // Once the theme checkpoint is ACKed, a failure in cron/cache/cleanup is a
    // partial success. Returning 503 here made the Builder retry the same
    // materialized Cookie Consent archive and create duplicate live releases.
    $acknowledge_activated_failure = new ReflectionMethod(
        $plugin,
        'acknowledge_activated_release_failure'
    );
    $acknowledged_release = $acknowledge_activated_failure->invoke(
        $plugin,
        'release-cookie-consent-online',
        new RuntimeException('falha simulada ao agendar o worker')
    );
    $publish_sync_report = (new ReflectionProperty($plugin, 'last_publish_sync_report'))->getValue($plugin);
    $recorded_post_activation_error = get_option('kodety_publish_sync_last_error', []);
    kodety_publication_assert(
        $acknowledged_release === 'release-cookie-consent-online'
            && !empty($publish_sync_report['syncPending'])
            && count((array) ($publish_sync_report['warnings'] ?? [])) === 1,
        'falha pós-ativação deve confirmar a release online como sincronização pendente'
    );
    kodety_publication_assert(
        is_array($recorded_post_activation_error)
            && ($recorded_post_activation_error['release'] ?? '') === 'release-cookie-consent-online'
            && str_contains((string) ($recorded_post_activation_error['message'] ?? ''), 'falha simulada'),
        'diagnóstico pós-ativação deve permanecer disponível sem devolver HTTP 503'
    );

    kodety_publication_expect_failure(
        static fn() => $plugin->sync_project_assets(),
        'assets ficou pendente'
    );
    kodety_publication_assert(
        !in_array(900, $state['deleted_attachments'], true),
        'falha intermediária de anexo não pode apagar assets obsoletos'
    );
    kodety_publication_assert(
        str_contains((string) file_get_contents($site_root . '/index.html'), 'assets/a.png'),
        'falha intermediária de anexo não pode reescrever referências'
    );
    kodety_publication_assert(
        get_option('kodety_assets_synced_release') === 'release-previous',
        'falha intermediária de anexo não pode confirmar a release'
    );

    // admin_init must never execute this heavy reconciliation. It only queues
    // a background worker, leaving the dashboard independent from the stale ACK.
    $scheduled_before_admin_assets = count($state['scheduled_events']);
    $attachment_sequence_before_admin = $state['next_attachment_id'];
    $state['schedule_failure'] = true;
    $plugin->maybe_sync_project_assets();
    $schedule_error = get_option('kodety_publish_sync_last_error', []);
    kodety_publication_assert(
        count($state['scheduled_events']) === $scheduled_before_admin_assets
            && is_array($schedule_error)
            && ($schedule_error['release'] ?? '') === 'release-next',
        'falha do cron deve ficar visível sem executar trabalho pesado no admin_init'
    );
    $state['schedule_failure'] = false;
    $plugin->maybe_sync_project_assets();
    kodety_publication_assert(
        get_option('kodety_assets_synced_release') === 'release-previous',
        'admin_init não pode confirmar um lote de assets que ele não executou'
    );
    kodety_publication_assert(
        count($state['scheduled_events']) === $scheduled_before_admin_assets + 1
            && ($state['scheduled_events'][array_key_last($state['scheduled_events'])]['args'] ?? null)
                === ['release-next', 1],
        'admin_init deve apenas agendar a reconciliação de assets da release ativa'
    );
    kodety_publication_assert(
        $state['next_attachment_id'] === $attachment_sequence_before_admin,
        'admin_init não pode tocar a Biblioteca de Mídia enquanto agenda o worker'
    );

    $state['fail_attachment_title'] = '';
    $state['fail_attached_file_title'] = 'b';
    kodety_publication_expect_failure(
        static fn() => $plugin->sync_project_assets(),
        'arquivo anexado não pôde ser confirmado'
    );
    kodety_publication_assert(
        !in_array(900, $state['deleted_attachments'], true)
            && get_option('kodety_assets_synced_release') === 'release-previous',
        'ACK silencioso de update_attached_file deve impedir cleanup e flag'
    );
    $state['fail_attached_file_title'] = '';
    chmod($site_root . '/index.html', 0444);
    kodety_publication_expect_failure(
        static fn() => $plugin->sync_project_assets(),
        'reescrever os assets'
    );
    kodety_publication_assert(
        !in_array(900, $state['deleted_attachments'], true),
        'falha de file_put_contents não pode executar cleanup de anexos'
    );
    kodety_publication_assert(
        get_option('kodety_assets_synced_release') === 'release-previous',
        'falha de file_put_contents não pode confirmar a release de assets'
    );

    chmod($site_root . '/index.html', 0644);
    $state['fail_option_key'] = 'kodety_assets_synced_release';
    $purges_before_failed_ack = $state['cache_purges'];
    kodety_publication_expect_failure(
        static fn() => $plugin->sync_project_assets(),
        'ACK final da sincronização de assets'
    );
    kodety_publication_assert(
        get_option('kodety_assets_synced_release') === 'release-previous',
        'update_option falso não pode se passar por ACK final de assets'
    );
    kodety_publication_assert(
        $state['cache_purges'] === $purges_before_failed_ack + 1,
        'CSS/HTML reescritos devem purgar o cache antes de tentar confirmar o ACK'
    );
    $state['fail_option_key'] = '';
    $purges_before_successful_retry = $state['cache_purges'];
    $plugin->sync_project_assets();
    kodety_publication_assert(
        in_array(900, $state['deleted_attachments'], true),
        'cleanup de anexos deve ocorrer depois do registro e rewrite completos'
    );
    kodety_publication_assert(
        get_option('kodety_assets_synced_release') === 'release-next',
        'sync completo de assets deve confirmar a release'
    );
    kodety_publication_assert(
        $state['cache_purges'] === $purges_before_successful_retry + 1,
        'retry idempotente deve purgar novamente mesmo quando as URLs já foram reescritas'
    );
    kodety_publication_assert(
        !str_contains((string) file_get_contents($site_root . '/index.html'), 'src="assets/a.png"'),
        'retry completo deve finalizar a reescrita das referências'
    );
    $asset_a_ids = get_posts([
        'post_type' => 'attachment',
        'meta_key' => '_kodety_asset_path',
        'meta_value' => 'assets/a.png',
    ]);
    $asset_a_id = (int) ($asset_a_ids[0] ?? 0);
    kodety_publication_assert($asset_a_id > 0, 'asset sincronizado deve permanecer localizável pelo caminho');
    $asset_a_url = wp_get_attachment_url($asset_a_id);
    kodety_publication_assert(
        is_string($asset_a_url)
            && str_starts_with($asset_a_url, 'https://example.test/uploads/')
            && str_contains((string) file_get_contents($site_root . '/index.html'), 'src="' . $asset_a_url . '"'),
        'HTML publicado deve manter a URL absoluta do attachment, como no fluxo anterior ao cache-busting'
    );
    $canonical_asset_file = get_attached_file($asset_a_id);
    $canonical_metadata = wp_get_attachment_metadata($asset_a_id);
    kodety_publication_assert(
        $state['metadata_calls'] === []
            && is_array($canonical_metadata)
            && ($canonical_metadata['sizes'] ?? null) === []
            && ($canonical_metadata['file'] ?? '') === get_post_meta($asset_a_id, '_wp_attached_file', true),
        'asset Kodety deve usar metadata intrínseca sem abrir o editor nem gerar subsizes'
    );
    $metadata_before_idempotent_sync = $state['attachment_metadata'][$asset_a_id];
    $plugin->sync_project_assets();
    kodety_publication_assert(
        $state['metadata_calls'] === []
            && $state['attachment_metadata'][$asset_a_id] === $metadata_before_idempotent_sync
            && get_attached_file($asset_a_id) === $canonical_asset_file,
        'asset byte-idêntico não pode reconstruir metadata nem tocar o editor novamente'
    );

    // Repair the legacy failure mode where WordPress had promoted a derivative
    // to the canonical attachment, producing -scaled-scaled on every retry.
    $legacy_scaled_file = preg_replace('/(\.[^.]+)$/', '-scaled$1', $canonical_asset_file);
    kodety_publication_assert(is_string($legacy_scaled_file), 'fixture scaled inválida');
    file_put_contents($legacy_scaled_file, 'legacy-scaled-derivative');
    $legacy_thumbnail_file = preg_replace('/(\.[^.]+)$/', '-150x150$1', $legacy_scaled_file);
    kodety_publication_assert(is_string($legacy_thumbnail_file), 'fixture thumbnail inválida');
    file_put_contents($legacy_thumbnail_file, 'legacy-thumbnail-derivative');
    $state['attachments'][$asset_a_id]['file'] = $legacy_scaled_file;
    $state['meta'][$asset_a_id]['_wp_attached_file'] = ltrim(
        substr($legacy_scaled_file, strlen(trailingslashit($state['upload_root']))),
        '/'
    );
    $state['attachment_metadata'][$asset_a_id] = [
        'file' => $state['meta'][$asset_a_id]['_wp_attached_file'],
        'sizes' => ['thumbnail' => ['file' => basename($legacy_thumbnail_file)]],
        'original_image' => basename($canonical_asset_file),
    ];
    $plugin->sync_project_assets();
    kodety_publication_assert(
        get_attached_file($asset_a_id) === $canonical_asset_file
            && !str_contains(get_attached_file($asset_a_id), '-scaled')
            && !is_file($legacy_scaled_file)
            && !is_file($legacy_thumbnail_file),
        'sync deve restaurar o original canônico e remover a família -scaled legada'
    );
    kodety_publication_assert(
        !array_key_exists('kodety_project_assets_sync_lock', $state['options']),
        'sync não pode depender de option-lock órfão após fatal/OOM'
    );

    kodety_publication_expect_failure(
        static fn() => $plugin->sync_project_pages(),
        'páginas ficou pendente'
    );
    kodety_publication_assert(
        $state['pages'][33]->post_status === 'publish',
        'falha em uma rota não pode lixar página obsoleta'
    );
    kodety_publication_assert(
        get_option('page_on_front') === 999,
        'falha em uma rota não pode finalizar a troca da página inicial'
    );
    kodety_publication_assert(
        get_option('kodety_pages_synced_release') === 'release-previous',
        'falha em uma rota não pode confirmar a release de páginas'
    );

    $scheduled_before_admin_pages = count($state['scheduled_events']);
    $page_22_status_before_admin = $state['pages'][22]->post_status;
    $plugin->maybe_sync_project_pages();
    kodety_publication_assert(
        get_option('kodety_pages_synced_release') === 'release-previous',
        'admin_init não pode executar nem confirmar a reconciliação de páginas'
    );
    kodety_publication_assert(
        count($state['scheduled_events']) === $scheduled_before_admin_pages
            && $state['pages'][22]->post_status === $page_22_status_before_admin,
        'o worker já agendado deve manter admin_init sem I/O e sem evento duplicado'
    );
    $scheduled_before_stale = count($state['scheduled_events']);
    $plugin->retry_publish_sync('release-stale', 1);
    kodety_publication_assert(
        count($state['scheduled_events']) === $scheduled_before_stale,
        'worker cron deve ignorar payload de uma release que não está mais ativa'
    );
    // Direct method calls do not consume the mocked cron event automatically.
    // Mirror WordPress cron before exercising the retry callback itself.
    $state['scheduled_events'] = array_values(array_filter(
        $state['scheduled_events'],
        static fn(array $event): bool => $event['args'] !== ['release-next', 1]
    ));
    $plugin->retry_publish_sync('release-next', 1);
    $last_event = $state['scheduled_events'][array_key_last($state['scheduled_events'])] ?? null;
    kodety_publication_assert(
        is_array($last_event)
            && $last_event['hook'] === 'kodety_publish_sync_retry'
            && $last_event['args'] === ['release-next', 2],
        'worker cron deve reagendar apenas a mesma release com backoff enumerado'
    );
    $scheduled_before_observation = count($state['scheduled_events']);
    $observed_pending = $plugin->publish_status(new WP_REST_Request([
        'release' => 'release-next',
    ]));
    $observed_pending_data = $observed_pending->get_data();
    kodety_publication_assert(
        $observed_pending->get_status() === 202
            && $observed_pending_data['publicationComplete'] === false
            && $observed_pending_data['syncPending'] === true
            && $observed_pending_data['syncResumeRequired'] === true
            && $observed_pending_data['syncAttempt'] === 1
            && count($state['scheduled_events']) === $scheduled_before_observation,
        'poll observacional com WP-Cron desativado deve manter 202 sem executar nem declarar ACK'
    );
    $resumed_pending = $plugin->publish_status(new WP_REST_Request([
        'release' => 'release-next',
        'resume' => '1',
    ]));
    $resumed_pending_data = $resumed_pending->get_data();
    kodety_publication_assert(
        $resumed_pending->get_status() === 202
            && $resumed_pending_data['publicationComplete'] === false
            && $resumed_pending_data['syncPending'] === true
            && $resumed_pending_data['syncStatus'] === 'pending'
            && $resumed_pending_data['syncAttempt'] === 2
            && get_option('kodety_pages_synced_release') === 'release-previous',
        'poll resume deve executar uma única tentativa e continuar em 202 enquanto faltar ACK'
    );
    $state['scheduled_events'] = array_values(array_filter(
        $state['scheduled_events'],
        static fn(array $event): bool => ($event['args'][0] ?? '') !== 'release-next'
    ));
    $scheduled_before_limit = count($state['scheduled_events']);
    $plugin->retry_publish_sync('release-next', 5);
    $terminal_error = get_option('kodety_publish_sync_last_error', []);
    kodety_publication_assert(
        count($state['scheduled_events']) === $scheduled_before_limit
            && is_array($terminal_error)
            && ($terminal_error['attempt'] ?? 0) === 5
            && ($terminal_error['terminal'] ?? false) === true,
        'worker exaurido deve persistir falha terminal sem reiniciar a cadeia'
    );
    $terminal_status = $plugin->publish_status(new WP_REST_Request([
        'release' => 'release-next',
        'resume' => '1',
    ]));
    $terminal_status_data = $terminal_status->get_data();
    kodety_publication_assert(
        $terminal_status->get_status() === 500
            && $terminal_status_data['success'] === false
            && $terminal_status_data['publicationComplete'] === false
            && $terminal_status_data['syncPending'] === false
            && $terminal_status_data['syncFailed'] === true
            && $terminal_status_data['syncStatus'] === 'failed'
            && $terminal_status_data['syncRetryable'] === false
            && count($state['scheduled_events']) === $scheduled_before_limit,
        'poll de falha terminal deve ser explícito e não executar retry infinito'
    );
    $plugin->maybe_sync_project_assets();
    $plugin->maybe_sync_project_pages();
    kodety_publication_assert(
        count($state['scheduled_events']) === $scheduled_before_limit,
        'admin_init não pode recriar attempt 1 depois de uma falha terminal'
    );
    // Continue the remaining fault matrix as a fresh, explicitly repaired
    // operator window; production never clears a terminal job automatically.
    update_option('kodety_publish_sync_last_error', [], false);

    $state['fail_page_update_id'] = 0;
    $state['fail_new_page_meta_key'] = '_kodety_route';
    file_put_contents(
        $theme_root . '/manifest.json',
        json_encode([
            '' => 'index.html',
            'about' => 'about.html',
            'contact' => 'contact.html',
        ], JSON_THROW_ON_ERROR)
    );
    kodety_publication_expect_failure(
        static fn() => $plugin->sync_project_pages(),
        '_kodety_route'
    );
    $partial_page_id = 40;
    kodety_publication_assert(
        $state['pages'][$partial_page_id]->post_status === 'trash',
        'página recém-inserida sem identidade completa deve ir para a Lixeira'
    );
    kodety_publication_assert(
        get_post_meta($partial_page_id, '_kodety_html_path', true) === 'contact.html',
        'identidade parcial deve permitir que o retry reencontre a página pelo caminho'
    );
    kodety_publication_assert(
        $state['pages'][33]->post_status === 'publish' && get_option('page_on_front') === 999,
        'falha de meta não pode limpar páginas nem finalizar front-page'
    );

    $state['fail_new_page_meta_key'] = '';
    $state['fail_trash_id'] = 33;
    kodety_publication_expect_failure(
        static fn() => $plugin->sync_project_pages(),
        'limpeza de páginas ficou pendente'
    );
    kodety_publication_assert(
        $state['pages'][33]->post_status === 'publish'
            && get_option('kodety_pages_synced_release') === 'release-previous',
        'wp_trash_post falso deve impedir o ACK final das páginas'
    );
    $state['fail_trash_id'] = 0;
    $state['fail_option_key'] = 'kodety_pages_synced_release';
    kodety_publication_expect_failure(
        static fn() => $plugin->sync_project_pages(),
        'ACK final da sincronização de páginas'
    );
    kodety_publication_assert(
        get_option('kodety_pages_synced_release') === 'release-previous',
        'update_option falso não pode se passar por ACK final de páginas'
    );
    $state['fail_option_key'] = '';
    $resumed_complete = $plugin->publish_status(new WP_REST_Request([
        'release' => 'release-next',
        'resume' => '1',
    ]));
    $resumed_complete_data = $resumed_complete->get_data();
    kodety_publication_assert(
        $resumed_complete->get_status() === 200
            && $resumed_complete_data['publicationComplete'] === true
            && $resumed_complete_data['syncPending'] === false
            && $resumed_complete_data['syncFailed'] === false
            && $resumed_complete_data['syncStatus'] === 'complete'
            && get_option('kodety_pages_synced_release') === 'release-next',
        'poll resume só pode retornar 200 depois de reler ambos os ACKs duráveis'
    );
    kodety_publication_assert(
        $state['pages'][$partial_page_id]->post_status === 'publish',
        'retry deve reutilizar e publicar a página parcial em vez de duplicá-la'
    );
    kodety_publication_assert(
        $state['next_page_id'] === 41,
        'retry por identidade não pode inserir uma segunda página para a mesma rota'
    );
    kodety_publication_assert(
        $state['pages'][33]->post_status === 'trash',
        'cleanup de páginas obsoletas deve ocorrer somente depois do lote completo'
    );
    kodety_publication_assert(
        get_option('page_on_front') === 11,
        'front-page deve ser finalizada depois de todas as rotas e metas'
    );
    kodety_publication_assert(
        get_option('kodety_pages_synced_release') === 'release-next',
        'sync completo de páginas deve confirmar a release'
    );
    $plugin->retry_publish_sync('release-next', 1);
    $page_sync_actions = array_values(array_filter(
        $state['actions'],
        static fn(array $action): bool => $action['hook'] === 'kodety_pages_sync_completed'
    ));
    kodety_publication_assert(
        count($page_sync_actions) === 1
            && get_option('kodety_pages_sync_notified_release') === 'release-next',
        'ACK das páginas deve disparar uma vez o hook independente do estado dos assets'
    );
    $plugin->retry_publish_sync('release-next', 1);
    kodety_publication_assert(
        count(array_filter(
            $state['actions'],
            static fn(array $action): bool => $action['hook'] === 'kodety_pages_sync_completed'
        )) === 1,
        'hook de páginas confirmado não pode repetir em outro worker'
    );

    $state['options']['kodety_workspace_revision'] = 7;
    $state['options']['kodety_workspace_css_digest'] = 'digest-confirmed';
    $state['active_theme'] = 'kodety-generated';
    $checkpoint = new ReflectionMethod($plugin, 'assert_release_activation_checkpoint');
    $checkpoint->invoke($plugin, 'release-next', 7, 'digest-confirmed', 'kodety-generated');
    $state['options']['kodety_workspace_revision'] = 6;
    kodety_publication_expect_failure(
        static fn() => $checkpoint->invoke(
            $plugin,
            'release-next',
            7,
            'digest-confirmed',
            'kodety-generated'
        ),
        'revision'
    );
    $state['options']['kodety_workspace_revision'] = 7;
    $state['active_theme'] = 'test-active-theme';
    kodety_publication_expect_failure(
        static fn() => $checkpoint->invoke(
            $plugin,
            'release-next',
            7,
            'digest-confirmed',
            'kodety-generated'
        ),
        'tema ativo'
    );

    $plugin_source = (string) file_get_contents(
        dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php'
    );
    $build_guard_offset = strpos($plugin_source, '$this->assert_coded_build_integrity(');
    $build_theme_offset = strpos($plugin_source, '$this->build_theme(', $build_guard_offset ?: 0);
    $switch_theme_offset = strpos($plugin_source, 'switch_theme($theme_slug)', $build_theme_offset ?: 0);
    kodety_publication_assert(
        $build_guard_offset !== false
            && $build_theme_offset !== false
            && $switch_theme_offset !== false
            && $build_guard_offset < $build_theme_offset
            && $build_theme_offset < $switch_theme_offset,
        'integridade do build JavaScript deve falhar antes de preparar ou trocar o tema'
    );
    $checkpoint_offset = strpos($plugin_source, '$this->assert_release_activation_checkpoint(');
    $activated_offset = strpos($plugin_source, '$activated = true;', $checkpoint_offset ?: 0);
    $backup_cleanup_offset = strpos(
        $plugin_source,
        'if (is_dir($backup)) $this->remove_tree($backup);',
        $activated_offset ?: 0
    );
    kodety_publication_assert(
        $checkpoint_offset !== false
            && $activated_offset !== false
            && $backup_cleanup_offset !== false
            && $checkpoint_offset < $activated_offset
            && $activated_offset < $backup_cleanup_offset,
        'checkpoint de opções/tema deve ocorrer antes do point-of-no-return e da remoção dos backups'
    );
    kodety_publication_assert(
        str_contains($plugin_source, "update_option('kodety_current_release', \$previous_activation['current_release']")
            && str_contains($plugin_source, "switch_theme(\$previous_activation['theme_stylesheet'])"),
        'falha no checkpoint deve restaurar release anterior e tema anterior enquanto há backups'
    );

    // The active generated theme may be from an older plugin build. Updating
    // its active PHP runtime files must be all-or-nothing. Membership is now
    // contributed only when its separately installed extension is active.
    $runtime_files = ['index.php', 'functions.php', 'performance.php', 'redirects.php'];
    $runtime_before = [];
    foreach ($runtime_files as $runtime_file) {
        $runtime_before[$runtime_file] = 'runtime-antigo-' . $runtime_file;
        file_put_contents($theme_root . '/' . $runtime_file, $runtime_before[$runtime_file]);
    }
    delete_option('kodety_theme_runtime_ack');
    $state['active_theme'] = 'kodety-generated';
    $state['runtime_fault_checkpoint'] = 'after_commit';
    $state['runtime_fault_file'] = 'functions.php';
    $refresh_runtime = new ReflectionMethod($plugin, 'refresh_theme_runtime');
    $validate_runtime_source = new ReflectionMethod($plugin, 'assert_valid_theme_runtime_source');
    $validate_runtime_source->invoke(
        $plugin,
        'valid.php',
        '<?php function kodety_runtime_syntax_guard_test(): void {}'
    );
    kodety_publication_expect_failure(
        static fn() => $validate_runtime_source->invoke(
            $plugin,
            'invalid.php',
            '<?php function kodety_runtime_syntax_guard_broken( {'
        ),
        'erro de sintaxe'
    );
    kodety_publication_expect_failure(
        static fn() => $refresh_runtime->invoke($plugin, $theme_root),
        'falha transacional simulada'
    );
    foreach ($runtime_files as $runtime_file) {
        kodety_publication_assert(
            file_get_contents($theme_root . '/' . $runtime_file) === $runtime_before[$runtime_file],
            'falha intermediária deve restaurar exatamente ' . $runtime_file
        );
    }
    kodety_publication_assert(
        get_option('kodety_theme_runtime_ack', null) === null,
        'rollback não pode confirmar digest/versão do runtime novo'
    );

    $state['runtime_fault_checkpoint'] = '';
    $state['runtime_fault_file'] = '';
    $state['runtime_replaced_files'] = [];
    $legacy_code_component_html = $site_root . '/legacy-code-component.html';
    file_put_contents(
        $legacy_code_component_html,
        '<!doctype html><body><script type="importmap" data-coday-code-components-importmap>'
            . '{"imports":{"react":"./old-react.mjs"}}</script>'
            . '<script type="module" data-coday-code-components-runtime>import "./.coday/components/legacy.mjs";</script>'
            . '</body>'
    );
    $plugin->maybe_refresh_active_theme_runtime(true);
    foreach ($runtime_files as $runtime_file) {
        kodety_publication_assert(
            file_get_contents($theme_root . '/' . $runtime_file)
                === file_get_contents(KODETY_DIR . 'theme-runtime/' . $runtime_file),
            'happy path deve confirmar o runtime-base em ' . $runtime_file
        );
    }
    $runtime_ack = get_option('kodety_theme_runtime_ack', []);
    kodety_publication_assert(
        is_array($runtime_ack)
            && ($runtime_ack['version'] ?? '') === KODETY_VERSION
            && is_string($runtime_ack['digest'] ?? null)
            && strlen($runtime_ack['digest']) === 64,
        'commit completo deve persistir ACK de versão e digest'
    );
    $repaired_code_component_html = (string) file_get_contents($legacy_code_component_html);
    $repaired_import_map_offset = strpos(
        $repaired_code_component_html,
        'data-coday-code-components-importmap'
    );
    $repaired_runtime_offset = strpos(
        $repaired_code_component_html,
        'data-coday-code-components-runtime'
    );
    kodety_publication_assert(
        substr_count($repaired_code_component_html, 'data-coday-code-components-importmap') === 1
            && $repaired_import_map_offset !== false
            && $repaired_runtime_offset !== false
            && $repaired_import_map_offset < $repaired_runtime_offset
            && str_contains(
                $repaired_code_component_html,
                '"@coday/components":"./.coday/runtime/react.mjs"'
            )
            && str_contains(
                $repaired_code_component_html,
                '"framer":"./.coday/runtime/react.mjs"'
            ),
        'reparo pós-publicação deve preservar um único import map completo antes do runtime, incluindo Framer'
    );
    kodety_publication_assert(
        file_get_contents($site_root . '/.coday/runtime/react.mjs')
            === file_get_contents(KODETY_DIR . 'assets/code-component-react-runtime.mjs'),
        'reparo pós-publicação deve instalar o runtime privado correspondente ao import map'
    );

    // A normal init with a confirmed version/theme must be a cheap option read:
    // no source/target staging, hashing checkpoint, or runtime write.
    $fault_hits_before_fast_path = $state['runtime_fault_hits'];
    $state['runtime_fault_checkpoint'] = 'after_stage';
    $plugin->maybe_refresh_active_theme_runtime();
    kodety_publication_assert(
        $state['runtime_fault_hits'] === $fault_hits_before_fast_path,
        'ACK atual deve evitar I/O pesado no init comum'
    );

    // A manual syntax-breaking edit must invalidate the cheap stat ACK and be
    // repaired during plugins_loaded, before WordPress includes functions.php.
    file_put_contents(
        $theme_root . '/functions.php',
        '<?php function kodety_runtime_manual_breakage( {'
    );
    $state['runtime_fault_checkpoint'] = '';
    $state['runtime_replaced_files'] = [];
    $plugin->maybe_refresh_active_theme_runtime();
    kodety_publication_assert(
        $state['runtime_replaced_files'] === ['functions.php'],
        'refresh preventivo deve substituir somente o arquivo PHP divergente antes do carregamento do tema'
    );
    kodety_publication_assert(
        file_get_contents($theme_root . '/functions.php')
            === file_get_contents(KODETY_DIR . 'theme-runtime/functions.php'),
        'reparo preventivo deve restaurar um functions.php sintaticamente válido'
    );
    $transaction_artifacts = array_filter(
        glob($theme_root . '/.*.kodety-*') ?: [],
        static fn(string $path): bool => !str_ends_with($path, '.kodety-runtime-update.lock')
    );
    kodety_publication_assert(
        $transaction_artifacts === [],
        'commit/rollback deve remover todos os arquivos temporários'
    );

    // Settings can remove every rollback snapshot in one operation while
    // preserving the currently published release when the author requests it.
    $state['options']['kodety_current_release'] = 'release-NextA';
    foreach (['release-NextA', 'release-previous', 'release-old'] as $release_id) {
        mkdir($storage_root . '/private/releases/' . $release_id . '/project', 0777, true);
        file_put_contents($storage_root . '/private/releases/' . $release_id . '/project/index.html', $release_id);
    }
    $snapshot_project = $storage_root . '/private/releases/release-previous/project';
    mkdir($snapshot_project . '/.incode', 0777, true);
    file_put_contents($snapshot_project . '/.incode/template.json', '{"historical":"saved-template"}');
    file_put_contents($snapshot_project . '/styles.css', 'body{color:#9393ff}');
    $state['options']['kodety_preview_token'] = str_repeat('d', 48);
    $options_before_snapshot_access = $state['options'];
    $inventory_method = new ReflectionMethod($plugin, 'release_snapshot_inventory');
    $restricted_inventory = $inventory_method->invoke($plugin);
    kodety_publication_assert(
        array_filter($restricted_inventory['items'], static fn(array $item): bool => $item['downloadUrl'] !== '' || $item['previewUrl'] !== '' || $item['restoreUrl'] !== '') === [],
        'usuários sem administração não devem receber ações de snapshot'
    );
    $state['capabilities'] = ['manage_options', 'kodety_publish', 'edit_theme_options'];
    $inventory = $inventory_method->invoke($plugin);
    $snapshot_ids = array_column($inventory['items'], 'id');
    $sorted_ids = $snapshot_ids;
    rsort($sorted_ids, SORT_STRING);
    kodety_publication_assert($snapshot_ids === $sorted_ids, 'snapshots devem ser listados do mais recente para o mais antigo');
    $historical = $inventory['items'][array_search('release-previous', $snapshot_ids, true)];
    parse_str((string) parse_url($historical['downloadUrl'], PHP_URL_QUERY), $download_query);
    kodety_publication_assert(
        ($download_query['action'] ?? '') === 'kodety_download_snapshot'
            && ($download_query['release'] ?? '') === 'release-previous'
            && ($download_query['_wpnonce'] ?? '') === wp_create_nonce('kodety_download_snapshot_release-previous')
            && str_contains($historical['restoreUrl'], '/rollback/release-previous'),
        'ações de snapshot devem apontar para endpoints autenticados e preservar o ID'
    );
    kodety_publication_assert(
        array_column(array_filter($inventory['items'], static fn(array $item): bool => $item['current']), 'id') === ['release-NextA'],
        'somente o snapshot publicado deve ser marcado como atual, preservando maiúsculas no ID'
    );
    $prepare_snapshot = new ReflectionMethod($plugin, 'prepare_snapshot_download_archive');
    $snapshot_archive = $prepare_snapshot->invoke($plugin, 'release-previous');
    kodety_publication_assert(is_string($snapshot_archive) && is_file($snapshot_archive), 'download deve gerar um ZIP temporário real');
    $snapshot_zip = new ZipArchive();
    $snapshot_zip->open($snapshot_archive);
    kodety_publication_assert(
        $snapshot_zip->getFromName('index.html') === 'release-previous'
            && $snapshot_zip->getFromName('styles.css') === 'body{color:#9393ff}'
            && $snapshot_zip->getFromName('.incode/template.json') === '{"historical":"saved-template"}',
        'ZIP histórico deve preservar HTML, assets e configurações da versão escolhida'
    );
    $snapshot_zip->close();
    unlink($snapshot_archive);
    $legacy_archive = $prepare_snapshot->invoke($plugin, 'release-old');
    $snapshot_zip->open($legacy_archive);
    kodety_publication_assert($snapshot_zip->getFromName('.incode/template.json') === false, 'snapshot legado não pode receber as configurações atuais');
    $snapshot_zip->close();
    unlink($legacy_archive);
    foreach (['', '../workspace', 'release-previous/../../workspace', ' release-previous', 'missing'] as $invalid_release) {
        $invalid_download = $prepare_snapshot->invoke($plugin, $invalid_release);
        kodety_publication_assert(is_wp_error($invalid_download) && $invalid_download->get_error_data()['status'] === 404, 'download deve rejeitar IDs ausentes ou inseguros');
    }
    symlink($storage_root . '/private/releases/release-previous', $storage_root . '/private/releases/linked-release');
    kodety_publication_assert(is_wp_error($prepare_snapshot->invoke($plugin, 'linked-release')), 'download não pode atravessar uma release simbólica');
    unlink($storage_root . '/private/releases/linked-release');
    $_GET = $download_query;
    $state['capabilities'] = [];
    kodety_publication_expect_failure(fn() => $plugin->admin_download_snapshot(), 'Sem permissão');
    $state['capabilities'] = ['manage_options', 'kodety_publish', 'edit_theme_options'];
    $_GET['_wpnonce'] = wp_create_nonce('kodety_download_snapshot_release-old');
    kodety_publication_expect_failure(fn() => $plugin->admin_download_snapshot(), 'Nonce inválido');
    $_GET['release'] = ['invalid'];
    kodety_publication_expect_failure(fn() => $plugin->admin_download_snapshot(), 'snapshot solicitado é inválido');
    $_GET = [];

    $preview_response = $plugin->snapshot_preview(new WP_REST_Request(['release' => 'release-previous']));
    kodety_publication_assert($preview_response instanceof WP_REST_Response, 'prévia deve ser preparada a partir dos arquivos históricos');
    $preview_data = $preview_response->get_data();
    preg_match('~/preview/([a-f0-9]{48})/~', $preview_data['url'], $preview_match);
    $snapshot_token = $preview_match[1] ?? '';
    $preview_directory = new ReflectionMethod($plugin, 'snapshot_preview_directory');
    kodety_publication_assert(
        $snapshot_token !== ''
            && $preview_directory->invoke($plugin, $snapshot_token) === $snapshot_project
            && array_column($preview_data['pages'], 'path') === ['index.html']
            && $preview_response->headers['Cache-Control'] === 'private, no-store',
        'prévia deve usar um token temporário isolado e listar somente páginas públicas'
    );
    $resolve_preview = new ReflectionMethod($plugin, 'resolve_preview_file');
    kodety_publication_assert(
        $resolve_preview->invoke($plugin, $snapshot_project, ['missing-page'], false) === false
            && !is_file($snapshot_project . '/.incode/preview-files.json'),
        'prévia histórica não deve gravar índices nem modificar o snapshot'
    );
    $state['transients']['kodety_snapshot_preview_' . $snapshot_token]['expires'] = time() - 1;
    kodety_publication_assert($preview_directory->invoke($plugin, $snapshot_token) === '', 'token expirado não deve abrir a prévia');
    kodety_publication_assert($preview_directory->invoke($plugin, '../workspace') === '', 'token inválido não deve resolver diretórios');
    kodety_publication_assert($state['options'] === $options_before_snapshot_access, 'listar, baixar e visualizar não podem alterar o workspace, a publicação ou o preview atual');

    $revision = (int) get_option('kodety_workspace_revision', 0);
    $conflict = $plugin->rollback(new WP_REST_Request(['release' => 'release-previous', 'expectedWorkspaceRevision' => $revision + 1]));
    kodety_publication_assert(
        is_wp_error($conflict) && $conflict->get_error_data()['status'] === 409
            && $state['options'] === $options_before_snapshot_access,
        'restauração deve rejeitar revisão desatualizada antes de alterar qualquer estado'
    );
    $invalid_restore = $plugin->rollback(new WP_REST_Request(['release' => '../workspace', 'expectedWorkspaceRevision' => $revision]));
    kodety_publication_assert(is_wp_error($invalid_restore) && $invalid_restore->get_error_data()['status'] === 404, 'restauração deve compartilhar a validação segura de IDs');

    $delete_snapshots = new ReflectionMethod($plugin, 'delete_release_snapshots');
    $preserving_result = $delete_snapshots->invoke($plugin, false);
    kodety_publication_assert(
        ($preserving_result['deletedCount'] ?? -1) === 2
            && is_dir($storage_root . '/private/releases/release-NextA')
            && !is_dir($storage_root . '/private/releases/release-previous')
            && !is_dir($storage_root . '/private/releases/release-old'),
        'limpeza em massa deve preservar somente o snapshot publicado quando solicitado'
    );
    $complete_result = $delete_snapshots->invoke($plugin, true);
    kodety_publication_assert(
        ($complete_result['deletedCount'] ?? -1) === 1
            && !is_dir($storage_root . '/private/releases/release-NextA')
            && ($complete_result['snapshots']['count'] ?? -1) === 0,
        'limpeza completa deve incluir o snapshot da release publicada quando selecionado'
    );
    mkdir($storage_root . '/private/workspace', 0777, true);
    file_put_contents($storage_root . '/private/workspace/index.html', '<!doctype html>');
    file_put_contents($storage_root . '/current.zip', 'legacy');
    mkdir($storage_root . '/private/releases/delete-with-project/project', 0777, true);
    $state['options']['kodety_project_name'] = 'Projeto descartável';
    $state['options']['kodety_original_name'] = 'projeto.zip';
    $state['options']['kodety_workspace_project_id'] = 'project-delete-test';
    $state['options']['kodety_last_published_at'] = '2026-08-01T00:00:00+00:00';
    $revision_before_delete = (int) $state['options']['kodety_workspace_revision'];
    $delete_single_project = new ReflectionMethod($plugin, 'delete_single_project');
    $delete_single_project->invoke($plugin);
    kodety_publication_assert(
        !is_dir($storage_root . '/private/workspace')
            && !is_dir($storage_root . '/private/releases')
            && !is_file($storage_root . '/current.zip')
            && get_option('kodety_project_name') === ''
            && get_option('kodety_workspace_project_id') === ''
            && (int) get_option('kodety_workspace_revision') === $revision_before_delete + 1,
        'exclusão do projeto único deve remover workspace, snapshots e identidade sem deixar estado reutilizável'
    );

    // Restore a real archive through the complete activation path, in the
    // isolated fixture only. Both the workspace and public theme must change.
    $restore_project = $storage_root . '/private/releases/restore-history/project';
    wp_mkdir_p($restore_project);
    $restored_html = '<!doctype html><html><head><title>Historical version</title></head><body><h1>Snapshot restored</h1></body></html>';
    file_put_contents($restore_project . '/index.html', $restored_html);
    wp_mkdir_p($storage_root . '/private/workspace');
    file_put_contents($storage_root . '/private/workspace/later-edit.html', '<h1>Later edit</h1>');
    $state['options']['kodety_default_pages_cleaned'] = true;
    $state['schedule_failure'] = false;
    $restore_revision = (int) get_option('kodety_workspace_revision', 0);
    $restored = $plugin->rollback(new WP_REST_Request([
        'release' => 'restore-history',
        'expectedWorkspaceRevision' => $restore_revision,
    ]));
    kodety_publication_assert(
        $restored instanceof WP_REST_Response,
        'restauração real deve concluir: ' . (is_wp_error($restored) ? $restored->get_error_message() : '')
    );
    $restored_data = $restored->get_data();
    kodety_publication_assert(
        $restored_data['success'] === true && $restored_data['releaseOnline'] === true
            && $restored_data['syncPending'] === true && $restored->get_status() === 202
            && $restored_data['release'] === get_option('kodety_current_release')
            && (int) get_option('kodety_workspace_revision') === $restore_revision + 1,
        'restauração deve confirmar a nova release e revisão sem afirmar que a sincronização pendente terminou'
    );
    kodety_publication_assert(
        file_get_contents($storage_root . '/private/workspace/index.html') === $restored_html
            && !is_file($storage_root . '/private/workspace/later-edit.html'),
        'restauração deve substituir o workspace pelos arquivos históricos'
    );
    kodety_publication_assert(
        str_contains((string) file_get_contents(get_theme_root() . '/kodety-generated/site/index.html'), '<h1>Snapshot restored</h1>'),
        'restauração deve publicar o HTML histórico no tema gerado'
    );

    // Nonvisual writers may save concurrently with a Builder, but replacing an
    // archive still requires the exact revision observed by its author.
    $concurrent_plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();
    $concurrent_storage = $test_root . '/concurrent-import-storage';
    $storage_property->setValue($concurrent_plugin, $concurrent_storage);
    $ensure_directories->invoke($concurrent_plugin);
    $concurrent_workspace = $concurrent_storage . '/private/workspace';
    wp_mkdir_p($concurrent_workspace);
    file_put_contents($concurrent_workspace . '/index.html', '<h1>Current settings</h1>');
    update_option('kodety_workspace_revision', 101, false);
    $concurrent_bytes = (string) file_get_contents($collision_zip_path);
    $missing_revision = $concurrent_plugin->save_project_draft(new WP_REST_Request([], [], $concurrent_bytes));
    kodety_publication_assert(
        is_wp_error($missing_revision) && $missing_revision->get_error_code() === 'kodety_draft_revision_required'
            && file_get_contents($concurrent_workspace . '/index.html') === '<h1>Current settings</h1>',
        'archive sem revisão não pode substituir o rascunho existente'
    );
    $missing_publish_revision = $concurrent_plugin->publish_project(new WP_REST_Request([], [], $concurrent_bytes));
    kodety_publication_assert(
        is_wp_error($missing_publish_revision) && $missing_publish_revision->get_error_code() === 'kodety_publish_revision_required'
            && file_get_contents($concurrent_workspace . '/index.html') === '<h1>Current settings</h1>',
        'publicação ZIP sem revisão não pode substituir rascunho ou tema'
    );
    $stale_archive = $concurrent_plugin->save_project_draft(new WP_REST_Request([], ['x-kodety-expected-revision' => '100'], $concurrent_bytes));
    kodety_publication_assert(
        is_wp_error($stale_archive) && $stale_archive->get_error_code() === 'kodety_workspace_conflict'
            && $stale_archive->get_error_data()['status'] === 409
            && file_get_contents($concurrent_workspace . '/index.html') === '<h1>Current settings</h1>'
            && (int) get_option('kodety_workspace_revision') === 101,
        'archive antigo retorna 409 e preserva arquivos e revisão da gravação concorrente'
    );
    $state['capabilities'] = ['kodety_import', 'kodety_publish', 'edit_theme_options'];
    $split_at = (int) floor(strlen($concurrent_bytes) / 2);
    $import_headers = [
        'x-kodety-admin-import' => '1',
        'x-kodety-upload-id' => str_repeat('a', 32),
        'x-kodety-upload-offset' => '0',
        'x-kodety-upload-total' => (string) strlen($concurrent_bytes),
        'x-kodety-original-name' => 'concurrent.zip',
        'x-kodety-replace-acknowledged' => '1',
        'x-kodety-replace-phrase' => 'SUBSTITUIR',
    ];
    $first_chunk = $concurrent_plugin->save_project_draft_chunk(new WP_REST_Request([], $import_headers, substr($concurrent_bytes, 0, $split_at)));
    kodety_publication_assert($first_chunk instanceof WP_REST_Response && !$first_chunk->get_data()['complete'], 'primeiro chunk preserva baseline sem substituir arquivos');
    update_option('kodety_workspace_revision', 102, false);
    file_put_contents($concurrent_workspace . '/index.html', '<h1>Concurrent language edit</h1>');
    // A retry of the first chunk must not silently advance the upload baseline.
    $first_retry = $concurrent_plugin->save_project_draft_chunk(new WP_REST_Request([], $import_headers, substr($concurrent_bytes, 0, $split_at)));
    kodety_publication_assert($first_retry instanceof WP_REST_Response, 'retry do primeiro chunk continua o mesmo upload');
    $import_headers['x-kodety-upload-offset'] = (string) $split_at;
    $stale_import = $concurrent_plugin->save_project_draft_chunk(new WP_REST_Request([], $import_headers, substr($concurrent_bytes, $split_at)));
    kodety_publication_assert(
        is_wp_error($stale_import) && $stale_import->get_error_code() === 'kodety_workspace_conflict'
            && $stale_import->get_error_data()['status'] === 409
            && file_get_contents($concurrent_workspace . '/index.html') === '<h1>Concurrent language edit</h1>'
            && (int) get_option('kodety_workspace_revision') === 102,
        'import em chunks mantém baseline inicial inclusive após retry e preserva edição salva durante upload'
    );
    kodety_publication_assert(glob($concurrent_storage . '/private/draft-uploads/*') === [], 'upload concluído em conflito remove staging e metadados sem tocar o projeto');
    $stage_import = new ReflectionMethod(Kodety_Plugin::class, 'stage_builder_import');
    try {
        $stage_import->invoke($concurrent_plugin, $collision_zip_path, 'captured.zip', false, 101);
        kodety_publication_assert(false, 'captura administrativa obsoleta deve falhar');
    } catch (DomainException $error) {
        kodety_publication_assert($error->getCode() === 409 && file_get_contents($concurrent_workspace . '/index.html') === '<h1>Concurrent language edit</h1>', 'importação ZIP/URL revalida baseline dentro do commit atômico');
    }
    $import_headers['x-kodety-upload-id'] = str_repeat('b', 32);
    $import_headers['x-kodety-upload-offset'] = '0';
    $fresh_import = $concurrent_plugin->save_project_draft_chunk(new WP_REST_Request([], $import_headers, $concurrent_bytes));
    kodety_publication_assert(
        $fresh_import instanceof WP_REST_Response && $fresh_import->get_data()['complete']
            && (int) get_option('kodety_workspace_revision') === 103
            && file_get_contents($concurrent_workspace . '/index.html') === '<!doctype html><title>Home</title>',
        'nova importação explicitamente confirmada com baseline atual conclui e incrementa a revisão: ' . (is_wp_error($fresh_import) ? $fresh_import->get_error_message() : wp_json_encode($fresh_import->get_data()))
    );
    // Exercise the import backstop with the actual sharing implementation too.
    require dirname(__DIR__) . '/kodety/includes/class-kodety-sharing.php';
    $session = 'visual_owner_session_12345';
    $lease = 'visual_owner_lease_1234567';
    $state['options']['kodety_workspace_mode'] = 'single';
    $state['options']['kodety_editor_lock'] = ['single' => [$session . ':' . $lease => [
        'sessionId' => $session, 'leaseId' => $lease, 'userId' => 42,
        'eligible' => true, 'mode' => 'edit', 'lastActive' => time(),
    ]]];
    $draft_guard = new ReflectionMethod(Kodety_Plugin::class, 'project_draft_editor_lock_error');
    $import_guard = new ReflectionMethod(Kodety_Plugin::class, 'admin_import_editor_lock_error');
    $owner_headers = ['x-kodety-editor-session' => $session, 'x-kodety-editor-lease' => $lease];
    kodety_publication_assert(
        $draft_guard->invoke($concurrent_plugin, new WP_REST_Request()) === null
            && $draft_guard->invoke($concurrent_plugin, new WP_REST_Request([], $owner_headers)) === null,
        'guard direto de draft admite superfícies não visuais e a sessão visual proprietária'
    );
    foreach ([['x-kodety-editor-session' => $session], ['x-kodety-editor-lease' => $lease], ['x-kodety-editor-session' => $session, 'x-kodety-editor-lease' => 'foreign_lease_1234567890']] as $invalid_headers) {
        $denied_draft = $draft_guard->invoke($concurrent_plugin, new WP_REST_Request([], $invalid_headers));
        kodety_publication_assert(is_wp_error($denied_draft) && $denied_draft->get_error_data()['status'] === 423, 'guard direto continua bloqueando contexto visual parcial ou sem posse');
    }
    $blocked_import = $import_guard->invoke($concurrent_plugin);
    kodety_publication_assert(
        is_wp_error($blocked_import) && $blocked_import->get_error_code() === 'kodety_workspace_conflict'
            && $blocked_import->get_error_data()['status'] === 409
            && $import_guard->invoke($concurrent_plugin, new WP_REST_Request([], $owner_headers)) === null,
        'backstop de substituição retorna conflito 409 e admite somente o próprio editor quando explicitamente identificado'
    );
    try {
        $stage_import->invoke($concurrent_plugin, $collision_zip_path, 'active-editor.zip', false, 103);
        kodety_publication_assert(false, 'commit administrativo não pode ignorar editor que abriu durante a preparação');
    } catch (DomainException $error) {
        kodety_publication_assert($error->getCode() === 409 && (int) get_option('kodety_workspace_revision') === 103, 'commit revalida backstop dentro do mutex sem alterar revisão');
    }
    $state['capabilities'][] = 'kodety_edit';
    $concurrent_plugin->install_template_source($collision_zip_path, 'owner-template.zip', 'Owner template', new WP_REST_Request([], $owner_headers));
    kodety_publication_assert((int) get_option('kodety_workspace_revision') === 104, 'aplicar template pelo proprietário visual propaga a sessão e não bloqueia o próprio editor');
    try {
        $concurrent_plugin->install_template_source($collision_zip_path, 'admin-template.zip', 'Admin template');
        kodety_publication_assert(false, 'template administrativo deve respeitar edição visual ativa');
    } catch (DomainException $error) {
        kodety_publication_assert($error->getCode() === 409 && (int) get_option('kodety_workspace_revision') === 104, 'template sem contexto visual mantém backstop de substituição');
    }

    echo "publication-sync-runtime: ok\n";
} finally {
    @chmod($site_root . '/index.html', 0644);
    kodety_publication_remove_tree($test_root);
}
