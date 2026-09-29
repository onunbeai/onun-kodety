<?php

/** Isolated contract, variable and HTML regression test for Social Images. */
define('ABSPATH', __DIR__);
define('MINUTE_IN_SECONDS', 60);
define('KODETY_DIR', dirname(__DIR__) . '/kodety/');

class WP_Error {
    public function __construct(private string $code, private string $message) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
}

// Social Image is license-gated in production; this suite exercises its full
// licensed implementation rather than the separate inactive-license contract.
final class Kodety_License {
    public static function instance(): self { static $instance; return $instance ??= new self(); }
    public function is_active(): bool { return true; }
    public function public_status(): array { return ['valid' => true, 'limits' => []]; }
}

class WP_Post {
    public function __construct(
        public int $ID,
        public string $post_type,
        public string $post_title,
        public string $post_name,
        public string $post_content = '',
        public int $post_author = 1,
        public string $post_status = 'publish',
        public int $post_parent = 0,
        public string $post_mime_type = '',
    ) {}
}

class WP_Term {
    public function __construct(
        public int $term_id,
        public string $name,
        public string $slug,
    ) {}
}

class WP_Taxonomy {
    public function __construct(
        public string $name,
        public bool $public = true,
        public bool $hierarchical = true,
    ) {}
}

$kodety_social_hooks = [];
$kodety_social_posts = [
    10 => new WP_Post(10, 'product', 'Café Aurora', 'cafe-aurora', '<p>Descrição longa</p>', 7),
    700 => new WP_Post(700, 'attachment', 'Social Image', 'social-image', '', 7, 'inherit'),
];
$kodety_social_meta = [
    10 => [
        '_thumbnail_id' => 501,
        '_price' => '129,90',
        'subtitle' => 'Edição limitada',
        '_kodety_social_image_attachment_id' => 700,
        '_kodety_social_image_template_id' => 'product-card',
    ],
    700 => [
        '_kodety_social_generated' => '1',
        '_kodety_social_source_post' => 10,
    ],
];
$kodety_social_options = [
    'blogname' => 'Kodety Café',
    'blogdescription' => 'Cafés especiais',
    'kodety_brand_logo_id' => 502,
    'kodety_cms_templates' => ['product' => 'templates/product.html'],
];
$kodety_social_theme = sys_get_temp_dir() . '/kodety-social-theme-' . bin2hex(random_bytes(5));
mkdir($kodety_social_theme, 0777, true);
mkdir($kodety_social_theme . '/site/assets', 0777, true);
mkdir($kodety_social_theme . '/site/assets/fonts', 0777, true);
mkdir($kodety_social_theme . '/site/dist/assets', 0777, true);
$kodety_social_prepared_font_hash = str_repeat('a', 64);
$kodety_social_prepared_font_relative = '.kodety-social/fonts/' . $kodety_social_prepared_font_hash . '.ttf';
mkdir($kodety_social_theme . '/site/dist/.kodety-social/fonts', 0777, true);
$kodety_social_background_path = $kodety_social_theme . '/site/assets/social-background.png';
if (extension_loaded('gd') && function_exists('imagecreatetruecolor')) {
    $kodety_social_background = imagecreatetruecolor(8, 8);
    imagefill($kodety_social_background, 0, 0, imagecolorallocate($kodety_social_background, 240, 80, 40));
    imagepng($kodety_social_background, $kodety_social_background_path);
    imagedestroy($kodety_social_background);
} else {
    file_put_contents(
        $kodety_social_background_path,
        base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlY42YAAAAASUVORK5CYII=')
    );
}
$kodety_social_webroot_asset_path = $kodety_social_theme . '/site/dist/assets/webroot-only.png';
copy($kodety_social_background_path, $kodety_social_webroot_asset_path);
copy(KODETY_DIR . 'assets/fonts/geist-regular.ttf', $kodety_social_theme . '/site/assets/fonts/project.ttf');
copy(
    KODETY_DIR . 'assets/fonts/geist-regular.ttf',
    $kodety_social_theme . '/site/dist/' . $kodety_social_prepared_font_relative
);
file_put_contents($kodety_social_theme . '/site/assets/fonts/invalid.ttf', 'not-a-font');
file_put_contents(
    $kodety_social_theme . '/site/assets/fonts/broken-sfnt.ttf',
    "\x00\x01\x00\x00" . str_repeat("\0", 8)
);
file_put_contents(
    $kodety_social_theme . '/manifest.json',
    json_encode(['' => 'dist/index.html'], JSON_UNESCAPED_SLASHES)
);
$kodety_social_attachment_path = $kodety_social_theme . '/social-generated.png';
copy($kodety_social_background_path, $kodety_social_attachment_path);
$kodety_social_uploads = sys_get_temp_dir() . '/kodety-social-uploads-' . bin2hex(random_bytes(5));
mkdir($kodety_social_uploads, 0777, true);
$kodety_social_remote_requests = [];
$kodety_social_scheduled_events = [];
$kodety_social_unscheduled_hooks = [];
$kodety_social_spawn_count = 0;
$kodety_social_deleted_attachments = [];
$kodety_social_cleaned_posts = [];
$kodety_social_cleaned_attachments = [];
$kodety_social_attachment_files = [
    501 => $kodety_social_background_path,
    502 => $kodety_social_background_path,
    700 => $kodety_social_attachment_path,
];
$kodety_social_attachment_metadata = [
    700 => ['width' => 1200, 'height' => 630, 'file' => 'kodety/social/post-10.png'],
];
$kodety_social_attachment_mimes = [
    501 => 'image/png',
    502 => 'image/png',
    700 => 'image/png',
];
$kodety_social_next_attachment_id = 800;
$kodety_social_fault = '';
$kodety_social_fault_hits = [];

function add_action(string $hook, callable $callback, int $priority = 10, int $accepted_args = 1): void {
    global $kodety_social_hooks;
    $kodety_social_hooks[$hook][] = compact('callback', 'priority', 'accepted_args');
}
function absint(mixed $value): int { return abs((int) $value); }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function esc_attr(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function esc_url(string $value): string { return preg_match('~^https?://~', $value) ? $value : ''; }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function get_template_directory(): string { global $kodety_social_theme; return $kodety_social_theme; }
function get_stylesheet(): string { return 'kodety-generated'; }
function wp_upload_dir(): array {
    global $kodety_social_uploads;
    return [
        'basedir' => $kodety_social_uploads,
        'baseurl' => 'https://example.test/uploads',
        'error' => false,
    ];
}
function wp_mkdir_p(string $directory): bool { return is_dir($directory) || mkdir($directory, 0777, true); }
function trailingslashit(string $value): string { return rtrim($value, '/\\') . '/'; }
function wp_parse_url(string $url): array|false { return parse_url($url); }
function wp_safe_remote_get(string $url, array $arguments = []): WP_Error {
    global $kodety_social_remote_requests;
    $kodety_social_remote_requests[] = [$url, $arguments];
    return new WP_Error('network_disabled', 'network disabled in test');
}
function wp_remote_retrieve_response_code(mixed $response): int { return 0; }
function wp_remote_retrieve_body(mixed $response): string { return ''; }
function attachment_url_to_postid(string $url): int {
    return match ($url) {
        'https://example.test/uploads/cafe.png' => 501,
        'https://example.test/uploads/logo.png' => 502,
        'https://example.test/uploads/social/post-10.png' => 700,
        default => 0,
    };
}
function get_attached_file(int $attachment_id): string|false {
    global $kodety_social_attachment_files;
    return $kodety_social_attachment_files[$attachment_id] ?? false;
}
function get_post(int $id): ?WP_Post { global $kodety_social_posts; return $kodety_social_posts[$id] ?? null; }
function get_post_meta(int $id, string $key, bool $single = false): mixed {
    global $kodety_social_meta;
    return $kodety_social_meta[$id][$key] ?? '';
}
function update_post_meta(int $id, string $key, mixed $value): bool {
    global $kodety_social_meta;
    $fault = match (true) {
        $id >= 800 && $key === '_kodety_social_generated' => 'attachment_ownership',
        $id >= 800 && $key === '_kodety_social_source_post' => 'attachment_source',
        $id >= 800 && $key === '_kodety_social_image_hash' => 'attachment_hash',
        $id >= 800 && $key === '_wp_attachment_image_alt' => 'attachment_alt',
        $id === 30 && $key === '_kodety_social_image_hash' => 'post_hash',
        $id === 30 && $key === '_kodety_social_image_template_id' => 'post_template',
        $id === 30 && $key === '_kodety_social_image_attachment_id' => 'post_attachment',
        default => '',
    };
    if ($fault !== '' && kodety_social_consume_fault($fault)) return false;
    $kodety_social_meta[$id][$key] = $value;
    return true;
}
function delete_post_meta(int $id, string $key): bool {
    global $kodety_social_meta;
    if ($id === 30
        && $key === '_kodety_social_image_error'
        && kodety_social_consume_fault('post_error_delete')) return false;
    unset($kodety_social_meta[$id][$key]);
    return true;
}
function get_option(string $key, mixed $default = false): mixed {
    global $kodety_social_options;
    return $kodety_social_options[$key] ?? $default;
}
function add_option(string $key, mixed $value, string $deprecated = '', bool $autoload = true): bool {
    global $kodety_social_options;
    if (array_key_exists($key, $kodety_social_options)) return false;
    $kodety_social_options[$key] = $value;
    return true;
}
function delete_option(string $key): bool {
    global $kodety_social_options;
    unset($kodety_social_options[$key]);
    return true;
}
function get_theme_mod(string $key, mixed $default = false): mixed { return $key === 'custom_logo' ? 502 : $default; }
function get_bloginfo(string $key): string {
    return match ($key) {
        'name' => 'Kodety Café',
        'description' => 'Cafés especiais',
        default => '',
    };
}
function home_url(string $path = ''): string { return 'https://example.test/' . ltrim($path, '/'); }
function get_permalink(WP_Post $post): string { return 'https://example.test/' . $post->post_name . '/'; }
function get_the_title(WP_Post $post): string { return $post->post_title; }
function get_the_excerpt(WP_Post $post): string { return 'Um café memorável'; }
function get_the_date(string $format, WP_Post $post): string { return '25/07/2026'; }
function get_the_author_meta(string $field, int $author_id): string {
    return match ($field) {
        'display_name' => 'Ana Barista',
        'first_name' => 'Ana',
        'last_name' => 'Barista',
        'description' => 'Especialista em cafés',
        default => '',
    };
}
function get_avatar_url(int $author_id, array $args = []): string { return 'https://avatar.example.test/ana.png'; }
function get_post_thumbnail_id(WP_Post|int $post): int {
    $id = $post instanceof WP_Post ? $post->ID : $post;
    return in_array($id, [10, 30], true) ? 501 : 0;
}
function wp_get_attachment_image_url(int $id, string $size = 'full'): string|false {
    $known = match ($id) {
        501 => 'https://example.test/uploads/cafe.png',
        502 => 'https://example.test/uploads/logo.png',
        700 => 'https://example.test/uploads/social/post-10.png',
        default => '',
    };
    if ($known !== '') return $known;
    global $kodety_social_attachment_files, $kodety_social_uploads;
    $file = $kodety_social_attachment_files[$id] ?? '';
    if (!is_string($file) || $file === '') return false;
    $prefix = trailingslashit($kodety_social_uploads);
    return str_starts_with($file, $prefix)
        ? 'https://example.test/uploads/' . substr($file, strlen($prefix))
        : false;
}
function wp_attachment_is_image(int $id): bool {
    global $kodety_social_attachment_mimes;
    return str_starts_with((string) ($kodety_social_attachment_mimes[$id] ?? ''), 'image/');
}
function wp_get_attachment_metadata(int $id): array|false {
    global $kodety_social_attachment_metadata;
    return $kodety_social_attachment_metadata[$id] ?? false;
}
function get_post_mime_type(int $id): string|false {
    global $kodety_social_attachment_mimes;
    return $kodety_social_attachment_mimes[$id] ?? false;
}
function wp_strip_all_tags(string $value): string { return strip_tags($value); }
function apply_filters(string $hook, mixed $value): mixed { return $value; }
function get_field(string $key, int $post_id): mixed { return get_post_meta($post_id, $key, true); }
function get_the_terms(WP_Post $post, string $taxonomy): array|false {
    return $taxonomy === 'product_cat' ? [new WP_Term(3, 'Cafés especiais', 'cafes-especiais')] : false;
}
function get_term_link(WP_Term $term): string { return 'https://example.test/categoria/' . $term->slug . '/'; }
function get_object_taxonomies(string $post_type, string $output = 'names'): array { return []; }
function get_post_types(array $arguments = [], string $output = 'names'): array { return ['page', 'post', 'product']; }
function get_posts(array $arguments): array {
    global $kodety_social_posts, $kodety_social_meta;
    $ids = [];
    foreach ($kodety_social_posts as $post) {
        $types = (array) ($arguments['post_type'] ?? 'any');
        $status = (string) ($arguments['post_status'] ?? 'publish');
        if ($status !== 'any' && $post->post_status !== $status) continue;
        if ($types !== ['any'] && !in_array($post->post_type, $types, true)) continue;
        if (isset($arguments['author']) && $post->post_author !== (int) $arguments['author']) continue;
        if (isset($arguments['meta_key'])
            && !array_key_exists((string) $arguments['meta_key'], $kodety_social_meta[$post->ID] ?? [])) continue;
        $ids[] = $post->ID;
    }
    sort($ids, SORT_NUMERIC);
    $offset = max(0, (int) ($arguments['offset'] ?? 0));
    $limit = (int) ($arguments['posts_per_page'] ?? $arguments['numberposts'] ?? -1);
    if ($offset > 0 || $limit >= 0) $ids = array_slice($ids, $offset, $limit >= 0 ? $limit : null);
    return ($arguments['fields'] ?? '') === 'ids' ? $ids : array_map('get_post', $ids);
}
function wp_is_post_revision(int $post_id): bool { return false; }
function wp_is_post_autosave(int $post_id): bool { return false; }
function wp_next_scheduled(string $hook, array $args = []): int|false {
    global $kodety_social_scheduled_events;
    foreach ($kodety_social_scheduled_events as $event) {
        if ($event['hook'] === $hook && $event['args'] === $args) return $event['timestamp'];
    }
    return false;
}
function wp_schedule_single_event(int $timestamp, string $hook, array $args = [], bool $wp_error = false): bool {
    global $kodety_social_scheduled_events;
    $kodety_social_scheduled_events[] = compact('timestamp', 'hook', 'args');
    return true;
}
function wp_unschedule_hook(string $hook): int {
    global $kodety_social_scheduled_events, $kodety_social_unscheduled_hooks;
    $before = count($kodety_social_scheduled_events);
    $kodety_social_scheduled_events = array_values(array_filter(
        $kodety_social_scheduled_events,
        static fn(array $event): bool => $event['hook'] !== $hook
    ));
    $kodety_social_unscheduled_hooks[] = $hook;
    return $before - count($kodety_social_scheduled_events);
}
function spawn_cron(float $gmt_time = 0): bool {
    global $kodety_social_spawn_count;
    $kodety_social_spawn_count++;
    return true;
}
function kodety_social_consume_fault(string $point): bool {
    global $kodety_social_fault, $kodety_social_fault_hits;
    if ($kodety_social_fault !== $point) return false;
    $kodety_social_fault = '';
    $kodety_social_fault_hits[] = $point;
    return true;
}
function wp_insert_attachment(
    array $post,
    string $file,
    int $parent = 0,
    bool $wp_error = false
): int|WP_Error {
    global $kodety_social_next_attachment_id, $kodety_social_posts, $kodety_social_meta;
    global $kodety_social_attachment_files, $kodety_social_attachment_mimes, $kodety_social_uploads;
    $attachment_id = ++$kodety_social_next_attachment_id;
    if (kodety_social_consume_fault('attachment_record')) return $attachment_id;
    $stored_parent = kodety_social_consume_fault('attachment_parent') ? 999999 : $parent;
    $stored_mime = kodety_social_consume_fault('attachment_not_image')
        ? 'text/plain'
        : (kodety_social_consume_fault('attachment_wrong_mime')
            ? 'image/jpeg'
            : (string) ($post['post_mime_type'] ?? ''));
    $kodety_social_posts[$attachment_id] = new WP_Post(
        $attachment_id,
        'attachment',
        (string) ($post['post_title'] ?? ''),
        'social-' . $attachment_id,
        '',
        1,
        (string) ($post['post_status'] ?? 'inherit'),
        $stored_parent,
        $stored_mime
    );
    $stored_file = kodety_social_consume_fault('attached_file')
        ? $kodety_social_uploads . '/missing-social-image.png'
        : $file;
    $kodety_social_attachment_files[$attachment_id] = $stored_file;
    $kodety_social_attachment_mimes[$attachment_id] = $stored_mime;
    $prefix = trailingslashit($kodety_social_uploads);
    $kodety_social_meta[$attachment_id]['_wp_attached_file'] = str_starts_with($stored_file, $prefix)
        ? substr($stored_file, strlen($prefix))
        : basename($stored_file);
    return $attachment_id;
}
function wp_generate_attachment_metadata(int $attachment_id, string $file): array|WP_Error {
    unset($attachment_id);
    $size = getimagesize($file);
    if (!is_array($size)) return new WP_Error('metadata', 'metadata unavailable');
    return [
        'width' => (int) $size[0],
        'height' => (int) $size[1],
        'file' => 'kodety/social/' . basename($file),
    ];
}
function wp_update_attachment_metadata(int $attachment_id, array $metadata): bool {
    global $kodety_social_attachment_metadata;
    if (kodety_social_consume_fault('metadata')) return false;
    if (kodety_social_consume_fault('metadata_dimensions')) $metadata['width'] = 1199;
    if (kodety_social_consume_fault('metadata_file')) $metadata['file'] = 'kodety/social/wrong-file.png';
    $kodety_social_attachment_metadata[$attachment_id] = $metadata;
    return true;
}
function wp_delete_attachment(int $attachment_id, bool $force_delete = false): WP_Post|false {
    global $kodety_social_deleted_attachments, $kodety_social_posts, $kodety_social_meta;
    global $kodety_social_attachment_files, $kodety_social_attachment_metadata, $kodety_social_attachment_mimes;
    $post = $kodety_social_posts[$attachment_id] ?? null;
    if (!$post instanceof WP_Post || $post->post_type !== 'attachment') return false;
    $kodety_social_deleted_attachments[] = [$attachment_id, $force_delete];
    $file = $kodety_social_attachment_files[$attachment_id] ?? '';
    if (is_string($file) && is_file($file)) @unlink($file);
    unset($kodety_social_posts[$attachment_id], $kodety_social_meta[$attachment_id]);
    unset(
        $kodety_social_attachment_files[$attachment_id],
        $kodety_social_attachment_metadata[$attachment_id],
        $kodety_social_attachment_mimes[$attachment_id]
    );
    return $post;
}
function clean_post_cache(int $post_id): void {
    global $kodety_social_cleaned_posts;
    $kodety_social_cleaned_posts[] = $post_id;
}
function clean_attachment_cache(int $attachment_id): void {
    global $kodety_social_cleaned_attachments;
    $kodety_social_cleaned_attachments[] = $attachment_id;
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-social-images.php';

function kodety_social_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

$project = sys_get_temp_dir() . '/kodety-social-project-' . bin2hex(random_bytes(5));
mkdir($project . '/.incode', 0777, true);
$site_template = [
    'id' => 'brand-default',
    'version' => 1,
    'name' => 'Kodety Brand',
    'width' => 1200,
    'height' => 630,
    'background' => [
        'color' => '#102030',
        'gradient' => [
            'enabled' => true,
            'angle' => 135,
            'from' => '#102030',
            'to' => '#57aeff',
        ],
        'image' => 'assets/social-background.png',
        'imageAttachmentId' => 501,
        'imageFit' => 'contain',
        'imageOpacity' => 0.35,
    ],
    'elements' => [
        [
            'id' => 'title',
            'type' => 'text',
            'x' => 80,
            'y' => 80,
            'width' => 800,
            'height' => 220,
            'text' => '{{page.title}}',
            'fontSize' => 72,
            'fontWeight' => 800,
            'color' => '#ffffff',
            'align' => 'center',
            'verticalAlign' => 'middle',
            'border' => ['color' => '#ffffff', 'width' => 2, 'radius' => 24],
            'shadow' => ['enabled' => true, 'color' => '#000000', 'opacity' => 0.35, 'blur' => 8, 'offsetX' => 2, 'offsetY' => 4],
        ],
        ['id' => 'sparkles', 'type' => 'icon', 'icon' => 'sparkles', 'color' => '#ffffff', 'strokeWidth' => 2, 'x' => 970, 'y' => 60, 'width' => 100, 'height' => 100],
        ['id' => 'rule', 'type' => 'shape', 'shape' => 'line', 'fill' => '#ffffff', 'x' => 80, 'y' => 340, 'width' => 500, 'height' => 12, 'border' => ['width' => 3, 'color' => '#ffffff', 'radius' => 6]],
        ['id' => 'invalid', 'type' => 'video', 'src' => 'https://attacker.example/video.mp4'],
    ],
];
$product_template = [
    'id' => 'product-card',
    'width' => 1200,
    'height' => 630,
    'background' => ['color' => '#fff8ef', 'gradient' => ['enabled' => false]],
    'elements' => [
        ['id' => 'image', 'type' => 'image', 'source' => '{{product.image}}', 'attachmentId' => 999, 'fit' => 'cover', 'x' => 700, 'y' => 0, 'width' => 500, 'height' => 630],
        ['id' => 'price', 'type' => 'text', 'text' => '{{product.price}}', 'color' => '#111111', 'fontFamily' => 'Georgia', 'fontWeight' => 700, 'italic' => true, 'x' => 70, 'y' => 390, 'width' => 500, 'height' => 100],
        ['id' => 'project-font', 'type' => 'text', 'text' => 'Projeto', 'color' => '#111111', 'fontFamily' => 'Project Sans', 'fontFile' => '/assets/fonts/project.ttf', 'fontFileWeight' => 400, 'fontWeight' => 800, 'x' => 70, 'y' => 500, 'width' => 500, 'height' => 80],
    ],
];
$budget_template = [
    'id' => 'pixel-budget',
    'width' => 1200,
    'height' => 630,
    'elements' => array_map(
        static fn(int $index): array => [
            'id' => 'large-' . $index,
            'type' => 'shape',
            'width' => 2400,
            'height' => 2400,
            'fill' => '#000000',
        ],
        range(1, 5)
    ),
];
$shared_page_settings = [];
for ($index = 1; $index <= 2500; $index++) {
    $shared_page_settings[sprintf('templates/shared-%04d.html', $index)] = [
        'socialImageTemplateId' => 'brand-default',
    ];
}
$page_settings = array_merge($shared_page_settings, [
    'templates/product.html' => [
        'socialTitle' => '{{title}} — {{subtitle}}',
        'socialDescription' => '{{subtitle}}',
        'canonicalUrl' => 'https://studio.example.test/produtos/{{slug}}/',
        'socialImageTemplateId' => 'product-card',
    ],
    'templates/shared-cms.html' => ['socialImageTemplateId' => 'brand-default'],
    'templates/pixel-budget.html' => ['socialImageTemplate' => $budget_template],
    'templates/missing-ref.html' => ['socialImageTemplateId' => 'template-removido'],
    'templates/missing-ref-legacy.html' => [
        'socialImageTemplateId' => 'template-removido',
        'socialImageTemplate' => $product_template,
    ],
    '../unsafe.html' => ['socialImageTemplateId' => 'brand-default'],
]);
file_put_contents($project . '/.incode/project.json', json_encode([
    'version' => 1,
    'name' => 'Projeto Kodety',
    'largeUnrelatedPayload' => str_repeat('x', 2_100_000),
    // Early library builds wrote the catalog at the project root. The
    // canonical editor catalog below must merge with it safely.
    'socialImageTemplates' => ['templates' => [$product_template]],
    'siteSettings' => [
        'siteTitle' => 'Kodety Studio',
        'description' => 'Identidade criada no Kodety',
        'baseUrl' => 'https://studio.example.test',
        'faviconLight' => 'assets/social-background.png',
        'socialImageTemplates' => [$site_template],
        'socialImageTemplateId' => 'brand-default',
        // A valid catalog reference wins; this embedded value remains only as
        // the backwards-compatible fallback for a missing reference.
        'socialImageTemplate' => $product_template,
    ],
    'pageSettings' => $page_settings,
    'socialImages' => [
        'postTypeTemplates' => ['post' => 'brand-default'],
    ],
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

$contract = Kodety_Social_Images::project_contract_from_directory($project);
kodety_social_assert(($contract['siteTemplate'] ?? '') === 'brand-default', 'deve extrair a atribuição padrão por ID');
kodety_social_assert(($contract['pageTemplates']['templates/product.html'] ?? '') === 'product-card', 'deve resolver catálogo top-level para página/CMS');
kodety_social_assert(($contract['pageTemplates']['templates/shared-0001.html'] ?? '') === 'brand-default', 'template compartilhado deve ser atribuído à primeira página');
kodety_social_assert(($contract['pageTemplates']['templates/shared-2500.html'] ?? '') === 'brand-default', 'template compartilhado deve escalar a milhares de páginas');
kodety_social_assert(($contract['pageTemplates']['templates/shared-cms.html'] ?? '') === 'brand-default', 'template compartilhado deve ser reutilizável por um caminho CMS');
kodety_social_assert(!isset($contract['pageTemplates']['templates/missing-ref.html']), 'referência removida deve herdar o template do site');
kodety_social_assert(($contract['pageTemplates']['templates/missing-ref-legacy.html'] ?? '') === 'product-card', 'referência removida deve preservar fallback embutido legado');
kodety_social_assert(!isset($contract['pageTemplates']['../unsafe.html']), 'caminhos que escapam do projeto devem ser rejeitados');
$contract_site_template = $contract['templates']['brand-default'] ?? [];
$contract_product_template = $contract['templates']['product-card'] ?? [];
$budget_template_id = $contract['pageTemplates']['templates/pixel-budget.html'] ?? '';
$contract_budget_template = is_string($budget_template_id)
    ? ($contract['templates'][$budget_template_id] ?? [])
    : [];
kodety_social_assert(count($contract_site_template['layers'] ?? []) === 3, 'elements canônicos devem ser projetados e tipos desconhecidos descartados');
kodety_social_assert(($contract_site_template['background']['type'] ?? '') === 'linear-gradient', 'gradientes devem sobreviver à projeção normalizada');
kodety_social_assert(($contract_site_template['backgroundImage'] ?? '') === 'assets/social-background.png', 'background.image canônico deve sobreviver à projeção');
kodety_social_assert(($contract_site_template['backgroundAttachmentId'] ?? 0) === 501, 'background da Biblioteca de Mídia deve preservar o attachment ID');
kodety_social_assert(($contract_site_template['backgroundImageFit'] ?? '') === 'contain', 'background.imageFit canônico deve sobreviver à projeção');
kodety_social_assert(($contract_site_template['backgroundImageOpacity'] ?? 0) === 0.35, 'background.imageOpacity canônico deve sobreviver à projeção');
kodety_social_assert(($contract_site_template['layers'][0]['textAlign'] ?? '') === 'center', 'align canônico deve controlar alinhamento de texto');
kodety_social_assert(($contract_site_template['layers'][0]['verticalAlign'] ?? '') === 'center', 'verticalAlign middle deve ser normalizado');
kodety_social_assert(($contract_site_template['layers'][0]['radius'] ?? 0) === 24.0, 'border.radius canônico deve ser normalizado');
kodety_social_assert(($contract_site_template['layers'][0]['shadow']['opacity'] ?? 0) === 0.35, 'shadow.opacity canônico deve ser preservado');
kodety_social_assert(($contract_site_template['layers'][1]['icon'] ?? '') === 'sparkles', 'ícones canônicos devem ser preservados');
kodety_social_assert(($contract_site_template['layers'][2]['shape'] ?? '') === 'line', 'shape line canônico deve ser preservado');
kodety_social_assert(($contract_product_template['layers'][0]['attachmentId'] ?? -1) === 0, 'source dinâmico deve vencer attachment estático residual');
kodety_social_assert(($contract_product_template['layers'][1]['italic'] ?? true) === false, 'itálico sem face empacotada deve ser desativado');
kodety_social_assert(($contract_product_template['layers'][1]['fontFamily'] ?? '') === 'Geist', 'fontFamily deve usar a face empacotada determinística');
kodety_social_assert(($contract_product_template['layers'][1]['fontWeight'] ?? 0) === 700, 'peso legado deve preservar os nove pesos CSS suportados');
kodety_social_assert(($contract_product_template['layers'][1]['shadow']['enabled'] ?? true) === false, 'layer sem shadow não pode ganhar sombra implícita');
kodety_social_assert(($contract_product_template['layers'][2]['fontFamily'] ?? '') === 'Project Sans', 'família com arquivo local deve sobreviver ao contrato');
kodety_social_assert(($contract_product_template['layers'][2]['fontFile'] ?? '') === 'assets/fonts/project.ttf', 'caminho TTF local deve sobreviver ao contrato');
kodety_social_assert(($contract_product_template['layers'][2]['fontFileWeight'] ?? 0) === 400, 'peso real do arquivo local deve sobreviver ao contrato');
kodety_social_assert(count($contract_budget_template['layers'] ?? []) === 4, 'budget cumulativo deve limitar o custo total das layers');
kodety_social_assert(count($contract['pageTemplates']) >= 2504, 'contrato compacto deve manter milhares de atribuições');
kodety_social_assert(
    is_string($contract['pageTemplates']['templates/shared-1000.html'] ?? null)
        && strlen((string) json_encode($contract)) < 1_000_000,
    'atribuições compartilhadas devem publicar IDs compactos, sem duplicar templates completos'
);
kodety_social_assert(($contract['siteVariables']['name'] ?? '') === 'Kodety Studio', 'siteSettings deve projetar site.name');
kodety_social_assert(($contract['siteVariables']['logo'] ?? '') === 'assets/social-background.png', 'favicon configurado deve projetar site.logo');
kodety_social_assert(($contract['pageVariables']['templates/product.html']['title'] ?? '') === '{{title}} — {{subtitle}}', 'SEO social da página deve projetar page.title');
kodety_social_assert(($contract['pageVariables']['templates/product.html']['excerpt'] ?? '') === '{{subtitle}}', 'SEO social da página deve projetar page.excerpt');

$sanitize_template = new ReflectionMethod(Kodety_Social_Images::class, 'sanitize_template');
$layout_template = $sanitize_template->invoke(null, [
    'id' => 'responsive-layout',
    'width' => 1200,
    'height' => 630,
    'elements' => [
        [
            'id' => 'anchored-copy',
            'type' => 'text',
            'text' => 'Um título social dinâmico que ocupa várias linhas de forma determinística',
            'x' => 10,
            'y' => 48,
            'width' => 53,
            'widthUnit' => 'percent',
            'height' => 32,
            'horizontalAnchor' => 'center',
            'verticalAnchor' => 'bottom',
            'autoHeight' => true,
            'fontSize' => 24,
            'lineHeight' => 1.2,
        ],
        [
            'id' => 'legacy-box',
            'type' => 'shape',
            'x' => 12,
            'y' => 16,
            'width' => 120,
            'height' => 40,
        ],
    ],
]);
$layout_text = $layout_template['layers'][0] ?? [];
$layout_legacy = $layout_template['layers'][1] ?? [];
kodety_social_assert(
    ($layout_text['width'] ?? 0) === 53.0
        && ($layout_text['widthUnit'] ?? '') === 'percent'
        && ($layout_text['horizontalAnchor'] ?? '') === 'center'
        && ($layout_text['verticalAnchor'] ?? '') === 'bottom'
        && ($layout_text['autoHeight'] ?? false) === true,
    'contrato responsivo deve preservar largura percentual, âncoras e auto-height'
);
kodety_social_assert(
    ($layout_legacy['width'] ?? 0) === 120
        && ($layout_legacy['widthUnit'] ?? '') === 'px'
        && ($layout_legacy['horizontalAnchor'] ?? '') === 'left'
        && ($layout_legacy['verticalAnchor'] ?? '') === 'top',
    'layers antigas devem manter semântica px/left/top'
);
$layer_width_pixels = new ReflectionMethod(Kodety_Social_Images::class, 'layer_width_pixels');
kodety_social_assert(
    $layer_width_pixels->invoke(null, $layout_text, 1200) === 636
        && $layer_width_pixels->invoke(null, $layout_legacy, 1200) === 120,
    'largura percentual deve ser resolvida contra o container e largura legada deve permanecer em px'
);
$anchored_position = new ReflectionMethod(Kodety_Social_Images::class, 'anchored_layer_position');
$bottom_center_position = $anchored_position->invoke(
    null,
    $layout_text,
    1200,
    630,
    636,
    200,
    0,
    0
);
kodety_social_assert(
    $bottom_center_position === [292, 382]
        && $bottom_center_position[1] + 200 === 630 - 48,
    'âncoras center/bottom devem conservar o centro horizontal e o inset inferior'
);
$legacy_position = $anchored_position->invoke(
    null,
    $layout_legacy,
    1200,
    630,
    120,
    40,
    0,
    0
);
kodety_social_assert($legacy_position === [12, 16], 'posição legada deve continuar usando x/y a partir do topo esquerdo');
$stack_template = $sanitize_template->invoke(null, [
    'id' => 'adaptive-stack',
    'width' => 1200,
    'height' => 630,
    'elements' => [
        [
            'id' => 'stack-title',
            'type' => 'text',
            'text' => 'Título',
            'x' => 100,
            'y' => 100,
            'width' => 300,
            'height' => 40,
            'fontSize' => 24,
            'lineHeight' => 1.2,
        ],
        [
            'id' => 'stack-description',
            'type' => 'text',
            'text' => str_repeat('Descrição dinâmica com várias linhas ', 8),
            'x' => 100,
            'y' => 160,
            'width' => 300,
            'height' => 40,
            'autoHeight' => true,
            'fontSize' => 24,
            'lineHeight' => 1.2,
        ],
    ],
    'stacks' => [[
        'id' => 'copy-stack',
        'elementIds' => ['stack-title', 'stack-description'],
        'direction' => 'vertical',
        'gap' => 20,
        'align' => 'start',
        'anchor' => 'center',
    ]],
]);
kodety_social_assert(
    ($stack_template['stacks'][0]['elementIds'] ?? []) === ['stack-title', 'stack-description']
        && ($stack_template['stacks'][0]['gap'] ?? 0) === 20.0,
    'sanitização deve preservar membros, ordem e gap do Stack'
);
$right_center_layer = array_merge($layout_text, [
    'x' => 30,
    'y' => 100,
    'horizontalAnchor' => 'right',
    'verticalAnchor' => 'center',
]);
kodety_social_assert(
    $anchored_position->invoke(
        null,
        $right_center_layer,
        1200,
        630,
        200,
        100,
        0,
        0
    ) === [970, 365],
    'âncoras right/center devem tratar x como inset direito e y como offset do centro'
);
$auto_height_limit = new ReflectionMethod(Kodety_Social_Images::class, 'auto_height_limit');
kodety_social_assert(
    $auto_height_limit->invoke(null, 630, 48.0, 'top') === 582
        && $auto_height_limit->invoke(null, 630, 48.0, 'bottom') === 582
        && $auto_height_limit->invoke(null, 630, 100.0, 'center') === 430,
    'auto-height deve respeitar a área disponível de cada âncora vertical'
);
$auto_budget_template = $sanitize_template->invoke(null, [
    'id' => 'auto-height-budget',
    'width' => 2400,
    'height' => 2400,
    'elements' => array_map(
        static fn(int $index): array => [
            'id' => 'auto-' . $index,
            'type' => 'text',
            'text' => '{{page.title}}',
            'width' => 100,
            'widthUnit' => 'percent',
            'height' => 1,
            'autoHeight' => true,
        ],
        range(1, 5)
    ),
]);
kodety_social_assert(
    count($auto_budget_template['layers'] ?? []) === 4,
    'auto-height deve reservar seu crescimento máximo no budget cumulativo de pixels'
);

$contract_from_metadata = new ReflectionMethod(Kodety_Social_Images::class, 'contract_from_metadata');
$missing_site_reference = $contract_from_metadata->invoke(null, [
    'siteSettings' => [
        'socialImageTemplates' => [$site_template],
        'socialImageTemplateId' => 'template-removido',
        'socialImageTemplate' => $product_template,
    ],
]);
kodety_social_assert(
    ($missing_site_reference['siteTemplate'] ?? '') === 'product-card',
    'referência padrão removida deve cair para o template embutido legado'
);
$duplicate_template_first = $site_template;
$duplicate_template_first['name'] = 'Versão antiga';
$duplicate_template_last = $site_template;
$duplicate_template_last['name'] = 'Versão atual';
$duplicate_library_contract = $contract_from_metadata->invoke(null, [
    'siteSettings' => [
        'socialImageTemplates' => [$duplicate_template_first, $duplicate_template_last],
        'socialImageTemplateId' => 'brand-default',
    ],
]);
kodety_social_assert(
    ($duplicate_library_contract['templates']['brand-default']['name'] ?? '') === 'Versão atual',
    'IDs duplicados no mesmo catálogo devem preservar a definição mais recente'
);
$reserved_template = $site_template;
$reserved_template['id'] = '__none__';
$reserved_library_contract = $contract_from_metadata->invoke(null, [
    'siteSettings' => [
        'socialImageTemplates' => [$reserved_template],
        'socialImageTemplateId' => '__none__',
    ],
]);
kodety_social_assert(
    ($reserved_library_contract['siteTemplate'] ?? null) === null
        && !isset($reserved_library_contract['templates']['__none__']),
    'IDs reservados da interface não podem virar templates publicados'
);
$canonical_assignment_contract = $contract_from_metadata->invoke(null, [
    'socialImageTemplates' => [$product_template],
    'siteSettings' => [
        'socialImageTemplates' => [$site_template],
    ],
    'pageSettings' => [
        'templates/canonical-wins.html' => ['socialImageTemplateId' => 'brand-default'],
        'templates/inherit.html' => [],
    ],
    'socialImages' => [
        'siteTemplate' => 'product-card',
        'pageTemplates' => [
            'templates/canonical-wins.html' => 'product-card',
            'templates/inherit.html' => 'product-card',
        ],
        'postTypeTemplates' => ['post' => 'product-card'],
    ],
]);
kodety_social_assert(
    ($canonical_assignment_contract['siteTemplate'] ?? null) === null
        && ($canonical_assignment_contract['pageTemplates']['templates/canonical-wins.html'] ?? '') === 'brand-default'
        && !isset($canonical_assignment_contract['pageTemplates']['templates/inherit.html'])
        && ($canonical_assignment_contract['postTypeTemplates'] ?? []) === [],
    'catálogo novo deve tornar siteSettings/pageSettings autoritativos e não ressuscitar aliases legados'
);
$legacy_alias_contract = $contract_from_metadata->invoke(null, [
    'socialImageTemplates' => [$product_template],
    'socialImages' => [
        'siteTemplate' => 'product-card',
        'pageTemplates' => ['templates/legacy-only.html' => 'product-card'],
    ],
]);
kodety_social_assert(
    ($legacy_alias_contract['siteTemplate'] ?? '') === 'product-card'
        && ($legacy_alias_contract['pageTemplates']['templates/legacy-only.html'] ?? '') === 'product-card',
    'aliases antigos devem continuar funcionando enquanto o projeto ainda não usa o catálogo canônico'
);

$sanitize_public_contract = new ReflectionMethod(Kodety_Social_Images::class, 'sanitize_public_contract');
$legacy_public_contract = $sanitize_public_contract->invoke(null, [
    'version' => 1,
    'siteTemplate' => $site_template,
    'pageTemplates' => [
        'templates/legacy-a.html' => $site_template,
        'templates/legacy-b.html' => $site_template,
    ],
    'postTypeTemplates' => [],
    'siteVariables' => [],
    'pageVariables' => [],
]);
kodety_social_assert(
    ($legacy_public_contract['siteTemplate'] ?? '') === 'brand-default'
        && ($legacy_public_contract['pageTemplates']['templates/legacy-a.html'] ?? '') === 'brand-default'
        && count($legacy_public_contract['templates'] ?? []) === 1,
    'contratos v1 com templates completos devem migrar para um catálogo compacto sem duplicação'
);

$recognized_contract = new ReflectionMethod(Kodety_Social_Images::class, 'is_recognized_contract_shape');
kodety_social_assert(
    $recognized_contract->invoke(null, []) === false,
    'JSON vazio/corrompido não pode autorizar limpeza de imagens geradas'
);
kodety_social_assert(
    $recognized_contract->invoke(null, [
        'version' => 2,
        'templates' => [],
        'siteTemplate' => null,
        'pageTemplates' => [],
        'postTypeTemplates' => [],
    ]) === true,
    'contrato v2 intencionalmente vazio deve continuar válido'
);
kodety_social_assert(
    $recognized_contract->invoke(null, [
        'version' => 2,
        'templates' => [],
        'siteTemplate' => 'brand-default',
        'pageTemplates' => [],
        'postTypeTemplates' => [],
    ]) === false,
    'contrato v2 com referência ausente não pode autorizar limpeza'
);
kodety_social_assert(
    $recognized_contract->invoke(null, [
        'version' => 1,
        'siteTemplate' => 'brand-default',
        'pageTemplates' => [],
        'postTypeTemplates' => [],
    ]) === false,
    'contrato v1 sem template completo não pode autorizar limpeza'
);

file_put_contents(
    $kodety_social_theme . '/social-images.json',
    json_encode($contract, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
);
$service = Kodety_Social_Images::instance();
$published = $service->published_contract();
kodety_social_assert(($published['pageTemplates']['templates/product.html'] ?? '') === 'product-card', 'runtime deve ler atribuições compactas do tema publicado');
$published_site_template = $published['templates'][$published['siteTemplate'] ?? ''] ?? [];
kodety_social_assert(($published_site_template['backgroundImage'] ?? '') === 'assets/social-background.png', 'segunda sanitização deve preservar background.image');
kodety_social_assert(($published_site_template['backgroundAttachmentId'] ?? 0) === 501, 'segunda sanitização deve preservar o attachment ID do background');
kodety_social_assert(($published_site_template['backgroundImageFit'] ?? '') === 'contain', 'segunda sanitização deve preservar background.imageFit');
kodety_social_assert(($published_site_template['backgroundImageOpacity'] ?? 0) === 0.35, 'segunda sanitização deve preservar background.imageOpacity');
$template_for_post = new ReflectionMethod(Kodety_Social_Images::class, 'template_for_post');
$kodety_social_posts[20] = new WP_Post(20, 'page', 'Página compartilhada', 'pagina-compartilhada');
$kodety_social_meta[20] = ['_kodety_html_path' => 'templates/shared-0042.html'];
$kodety_social_posts[21] = new WP_Post(21, 'page', 'Referência removida', 'referencia-removida');
$kodety_social_meta[21] = ['_kodety_html_path' => 'templates/missing-ref.html'];
$kodety_social_posts[22] = new WP_Post(22, 'article', 'Conteúdo CMS', 'conteudo-cms');
$kodety_social_options['kodety_cms_templates']['article'] = 'templates/shared-cms.html';
kodety_social_assert(
    (($template_for_post->invoke($service, $kodety_social_posts[20]))['id'] ?? '') === 'brand-default',
    'página deve resolver o template compartilhado somente quando necessário'
);
kodety_social_assert(
    (($template_for_post->invoke($service, $kodety_social_posts[22]))['id'] ?? '') === 'brand-default',
    'conteúdo CMS deve resolver a mesma entrada compartilhada do catálogo'
);
kodety_social_assert(
    (($template_for_post->invoke($service, $kodety_social_posts[21]))['id'] ?? '') === 'brand-default',
    'referência de página ausente deve herdar o template padrão do site'
);
kodety_social_assert(isset($kodety_social_hooks['wp_after_insert_post']), 'runtime deve observar o estado final do post');
kodety_social_assert(isset($kodety_social_hooks['updated_post_meta']), 'runtime deve reagir a campos gravados após wp_update_post');
kodety_social_assert(isset($kodety_social_hooks['shutdown']), 'runtime deve adiar o enqueue até o final da request');
kodety_social_assert(isset($kodety_social_hooks['kodety_published']), 'publicar um projeto deve permitir regeneração global');
kodety_social_assert(isset($kodety_social_hooks['kodety_social_images_generate']), 'worker assíncrono deve estar registrado');
kodety_social_assert(isset($kodety_social_hooks['kodety_social_images_scan']), 'varredura paginada deve estar registrada');
kodety_social_assert(isset($kodety_social_hooks['before_delete_post']), 'exclusão permanente deve limpar mídia gerada');
kodety_social_assert(
    ($kodety_social_hooks['before_delete_post'][0]['accepted_args'] ?? 0) === 2,
    'before_delete_post deve receber o post já resolvido pelo WordPress'
);

for ($post_id = 1000; $post_id < 1045; $post_id++) {
    $kodety_social_posts[$post_id] = new WP_Post($post_id, 'post', 'Post ' . $post_id, 'post-' . $post_id);
    $service->queue_post($post_id);
}
$service->flush_queue();
$generation_events = array_values(array_filter(
    $kodety_social_scheduled_events,
    static fn(array $event): bool => $event['hook'] === 'kodety_social_images_generate'
));
kodety_social_assert(count($generation_events) === 1, 'uma request deve criar um lote cron, não um evento por post');
kodety_social_assert(
    count($generation_events[0]['args'][0]['post_ids'] ?? []) === 45,
    'payload cron deve agrupar conteúdos sujos em um lote limitado'
);
for ($post_id = 1000; $post_id < 1045; $post_id++) $service->queue_post($post_id);
$service->flush_queue();
$generation_events_after_duplicate = array_values(array_filter(
    $kodety_social_scheduled_events,
    static fn(array $event): bool => $event['hook'] === 'kodety_social_images_generate'
));
kodety_social_assert(
    count($generation_events_after_duplicate) === 1,
    'requests concorrentes devem reutilizar um evento cron idêntico'
);
$service->dispatch_scheduled_cron();
$service->dispatch_scheduled_cron();
kodety_social_assert($kodety_social_spawn_count === 1, 'dispatcher deve iniciar WP-Cron uma única vez por request');

class Kodety_Social_Test_WPDB {
    public string $posts = 'wp_posts';
    public string $postmeta = 'wp_postmeta';
    public array $prepared_arguments = [];
    public function __construct(public array $pages) {}
    public function prepare(string $query, mixed ...$arguments): string {
        $this->prepared_arguments[] = $arguments;
        return $query;
    }
    public function get_col(string $query): array {
        unset($query);
        return array_shift($this->pages) ?? [];
    }
}
for ($post_id = 10001; $post_id <= 10205; $post_id++) {
    $kodety_social_posts[$post_id] = new WP_Post($post_id, 'post', 'Post ' . $post_id, 'post-' . $post_id);
}
$wpdb = new Kodety_Social_Test_WPDB([range(10001, 10200), range(10201, 10205)]);
$queued_first_page = $service->scan_queued_posts(['mode' => 'regenerate', 'after_id' => 0]);
kodety_social_assert($queued_first_page === 200, 'varredura deve processar um primeiro lote limitado');
$scan_events = array_values(array_filter(
    $kodety_social_scheduled_events,
    static fn(array $event): bool => $event['hook'] === 'kodety_social_images_scan'
));
kodety_social_assert(count($scan_events) === 1, 'um lote cheio deve agendar a continuação da varredura');
$scan_payload = $scan_events[0]['args'][0] ?? [];
kodety_social_assert(($scan_payload['after_id'] ?? 0) === 10200, 'cursor deve avançar além do antigo teto de 10 mil IDs');
kodety_social_assert(($scan_payload['page'] ?? 0) === 2, 'fallback paginado deve avançar para a próxima página');
$queued_second_page = $service->scan_queued_posts($scan_payload);
kodety_social_assert($queued_second_page === 5, 'continuação deve processar os IDs restantes sem teto global');
kodety_social_assert(
    count($wpdb->prepared_arguments) === 2
        && ($wpdb->prepared_arguments[1][0] ?? 0) === 10200,
    'consulta deve usar paginação por cursor de ID, sem offsets crescentes'
);
$wpdb = null;

$post = $kodety_social_posts[10];
kodety_social_assert($service->resolve_variable_for_post('page.title', $post) === 'Café Aurora — Edição limitada', 'page.title deve combinar SEO projetado e conteúdo final');
kodety_social_assert($service->resolve_variable_for_post('page.excerpt', $post) === 'Edição limitada', 'page.excerpt deve usar SEO projetado');
kodety_social_assert($service->resolve_variable_for_post('page.url', $post) === 'https://studio.example.test/produtos/cafe-aurora/', 'page.url deve resolver canonical projetada');
kodety_social_assert($service->resolve_variable_for_post('author.name', $post) === 'Ana Barista', 'author.name deve resolver o autor');
kodety_social_assert($service->resolve_variable_for_post('site.name', $post) === 'Kodety Studio', 'site.name deve respeitar siteSettings publicado');
kodety_social_assert($service->resolve_variable_for_post('site.logo', $post) === 'assets/social-background.png', 'site.logo deve respeitar o asset configurado no Kodety');
kodety_social_assert($service->resolve_variable_for_post('product.price', $post) === '129,90', 'product.price deve aceitar o fallback de meta');
kodety_social_assert($service->resolve_variable_for_post('product.image', $post) === 'https://example.test/uploads/cafe.png', 'product.image deve resolver a imagem destacada');
kodety_social_assert($service->resolve_variable_for_post('category.name', $post) === 'Cafés especiais', 'category.name deve resolver a taxonomia pública');
kodety_social_assert($service->resolve_variable_for_post('field.subtitle', $post) === 'Edição limitada', 'field.* deve resolver campos Kodety/ACF');
kodety_social_assert($service->resolve_variable_for_post('field._secret', $post) === '', 'variáveis não podem ler meta protegida');

$raw_script = 'const sample=`<meta property="og:image" content="inside-script.png">`;';
$html = '<!doctype html><html><head>'
    . '<meta name="description" content="Descrição preservada">'
    . '<meta property="og:image" content="old.png">'
    . '<meta name="twitter:card" content="summary">'
    . '<meta name="twitter:image" content="old.png">'
    . '<script>' . $raw_script . '</script>'
    . '</head><body></body></html>';
$social_html = $service->apply_to_html($html, 10);
$social_head = str_replace('<script>' . $raw_script . '</script>', '', $social_html);
kodety_social_assert(substr_count($social_head, '<meta property="og:image" ') === 1, 'deve substituir a declaração OG sem duplicá-la');
kodety_social_assert(substr_count($social_head, '<meta name="twitter:image" ') === 1, 'deve substituir a declaração Twitter sem duplicá-la');
kodety_social_assert(str_contains($social_html, 'content="https://example.test/uploads/social/post-10.png"'), 'metatags devem apontar para o attachment gerado');
kodety_social_assert(str_contains($social_html, 'property="og:image:width" content="1200"'), 'deve publicar a largura OG');
kodety_social_assert(str_contains($social_html, 'property="og:image:height" content="630"'), 'deve publicar a altura OG');
kodety_social_assert(str_contains($social_html, 'property="og:image:type" content="image/png"'), 'deve publicar o MIME OG');
kodety_social_assert(str_contains($social_html, 'name="description" content="Descrição preservada"'), 'metadados não sociais devem permanecer intactos');
kodety_social_assert(str_contains($social_html, $raw_script), 'strings dentro de script/style devem permanecer byte a byte');

rename($kodety_social_attachment_path, $kodety_social_attachment_path . '.missing');
kodety_social_assert(
    $service->apply_to_html($html, 10) === $html,
    'attachment registrado sem PNG local não pode ser servido como social image'
);
rename($kodety_social_attachment_path . '.missing', $kodety_social_attachment_path);

$kodety_social_meta[10]['_kodety_social_image_template_id'] = 'obsolete-template';
kodety_social_assert(
    $service->apply_to_html($html, 10) === $html,
    'attachment de um template antigo não pode sobrescrever metatags atuais'
);
$kodety_social_meta[10]['_kodety_social_image_template_id'] = 'product-card';

$local_path = new ReflectionMethod(Kodety_Social_Images::class, 'local_image_path');
kodety_social_assert(
    $local_path->invoke($service, 'assets/webroot-only.png', 0) === realpath($kodety_social_webroot_asset_path),
    'assets relativos devem resolver dentro do web root publicado indicado pelo manifest'
);
kodety_social_assert(
    $local_path->invoke($service, 'assets/social-background.png', 999999) === realpath($kodety_social_background_path),
    'attachment removido deve cair para o source local seguro preservado no template'
);
kodety_social_assert(
    $local_path->invoke($service, '%2e%2e%2fsocial-background.png', 0) === null
        && $local_path->invoke($service, '..%5csocial-background.png', 0) === null
        && $local_path->invoke($service, 'assets%00/social-background.png', 0) === null,
    'traversal e NUL codificados devem ser rejeitados antes de consultar o filesystem'
);
kodety_social_assert(
    $local_path->invoke($service, 'https://attacker.example/private.png', 0) === null,
    'URLs externas arbitrárias não podem ser buscadas'
);
kodety_social_assert(count($kodety_social_remote_requests) === 0, 'URL não confiável não deve chegar à API HTTP');
kodety_social_assert(
    $local_path->invoke($service, [
        'url' => 'https://attacker.example/avatar/hash',
        'trustedRemote' => 'avatar',
    ], 0) === null,
    'marcação de avatar não pode contornar o allowlist de host'
);
kodety_social_assert(count($kodety_social_remote_requests) === 0, 'host de avatar não permitido não deve chegar à API HTTP');
$local_path->invoke($service, [
    'url' => 'https://secure.gravatar.com/avatar/0123456789abcdef?s=512',
    'trustedRemote' => 'avatar',
], 0);
kodety_social_assert(count($kodety_social_remote_requests) === 1, 'Gravatar resolvido pelo WordPress deve usar o cliente HTTP seguro');
kodety_social_assert(
    ($kodety_social_remote_requests[0][1]['redirection'] ?? -1) === 0
        && ($kodety_social_remote_requests[0][1]['reject_unsafe_urls'] ?? false) === true,
    'download de Gravatar deve rejeitar redirects e destinos inseguros'
);

$font_path = new ReflectionMethod(Kodety_Social_Images::class, 'font_path');
$local_font_path = new ReflectionMethod(Kodety_Social_Images::class, 'local_font_path');
kodety_social_assert(
    $local_font_path->invoke(null, '.incode/fonts/private.ttf') === ''
        && $local_font_path->invoke(null, 'assets/%2e%2e/private.ttf') === '',
    'fontes privadas do editor e traversal codificado devem ser rejeitados pelo contrato'
);
kodety_social_assert(
    $local_font_path->invoke(null, $kodety_social_prepared_font_relative)
        === $kodety_social_prepared_font_relative,
    'fonte preparada em .kodety-social/fonts deve sobreviver ao contrato publicado'
);
$social_font_weight = new ReflectionMethod(Kodety_Social_Images::class, 'social_font_weight');
kodety_social_assert(
    $social_font_weight->invoke(null, 'semi-bold') === 600
        && $social_font_weight->invoke(null, '700') === 700
        && $social_font_weight->invoke(null, 900) === 900,
    'renderer deve normalizar todos os nove pesos CSS e seus aliases'
);
$synthetic_font_stroke = new ReflectionMethod(Kodety_Social_Images::class, 'synthetic_font_stroke');
kodety_social_assert(
    $synthetic_font_stroke->invoke(null, [
        'fontFile' => 'assets/fonts/project.ttf',
        'fontFileWeight' => 800,
        'fontWeight' => 800,
    ]) === 0
        && $synthetic_font_stroke->invoke(null, [
            'fontFile' => 'assets/fonts/project.ttf',
            'fontFileWeight' => 700,
            'fontWeight' => 800,
        ]) === 1
        && $synthetic_font_stroke->invoke(null, [
            'fontFile' => 'assets/fonts/project.ttf',
            'fontFileWeight' => 400,
            'fontWeight' => 800,
        ]) === 2,
    'negrito sintético deve considerar a diferença entre peso solicitado e peso real do arquivo'
);
$resolved_font = $font_path->invoke($service, $published_site_template['layers'][0]);
kodety_social_assert(
    $resolved_font === KODETY_DIR . 'assets/fonts/geist-regular.ttf',
    'renderer deve usar a Geist empacotada quando a layer não aponta uma fonte do projeto'
);
$resolved_project_font = $font_path->invoke($service, [
    'fontFamily' => 'Project Sans',
    'fontFile' => 'assets/fonts/project.ttf',
]);
kodety_social_assert(
    $resolved_project_font === realpath($kodety_social_theme . '/site/assets/fonts/project.ttf'),
    'renderer deve resolver TTF/OTF do projeto dentro do tema publicado'
);
$resolved_prepared_font = $font_path->invoke($service, [
    'fontFamily' => 'Prepared Project Sans',
    'fontFile' => $kodety_social_prepared_font_relative,
]);
kodety_social_assert(
    $resolved_prepared_font === realpath(
        $kodety_social_theme . '/site/dist/' . $kodety_social_prepared_font_relative
    ),
    'renderer deve resolver a fonte social preparada no web root do build Vite'
);
kodety_social_assert(
    $font_path->invoke($service, [
        'fontFamily' => 'Invalid Project Sans',
        'fontFile' => 'assets/fonts/invalid.ttf',
    ]) === '',
    'arquivo local sem assinatura SFNT deve ser rejeitado antes do FreeType'
);
$resolved_broken_sfnt = $font_path->invoke($service, [
    'fontFamily' => 'Broken Project Sans',
    'fontFile' => 'assets/fonts/broken-sfnt.ttf',
]);
kodety_social_assert(
    $resolved_broken_sfnt === realpath($kodety_social_theme . '/site/assets/fonts/broken-sfnt.ttf'),
    'assinatura SFNT válida deve passar pela checagem barata anterior ao FreeType'
);

if (extension_loaded('gd') && function_exists('imagecreatetruecolor')) {
    $render = new ReflectionMethod(Kodety_Social_Images::class, 'render_template');
    $broken_font_template = $sanitize_template->invoke(null, [
        'id' => 'broken-font',
        'width' => 320,
        'height' => 180,
        'background' => ['color' => '#FFFFFF'],
        'elements' => [[
            'id' => 'broken-text',
            'type' => 'text',
            'text' => 'Este texto não pode desaparecer silenciosamente',
            'fontFamily' => 'Broken Project Sans',
            'fontFile' => 'assets/fonts/broken-sfnt.ttf',
            'fontFileWeight' => 400,
            'fontWeight' => 700,
            'fontSize' => 28,
            'color' => '#000000',
            'x' => 12,
            'y' => 12,
            'width' => 296,
            'height' => 80,
        ]],
    ]);
    $broken_font_render = $render->invoke($service, $broken_font_template, $post);
    kodety_social_assert(
        is_wp_error($broken_font_render)
            && $broken_font_render->get_error_code() === 'kodety_social_font_invalid',
        'falha do FreeType deve impedir publicação em vez de produzir texto vazio'
    );
    $image = $render->invoke($service, $published_site_template, $post);
    kodety_social_assert(!is_wp_error($image), 'GD deve renderizar um template sanitizado');
    kodety_social_assert(imagesx($image) === 1200 && imagesy($image) === 630, 'renderer deve respeitar as dimensões exatas do canvas');
    $png = $kodety_social_theme . '/preview.png';
    imagepng($image, $png, 7);
    imagedestroy($image);
    kodety_social_assert(substr((string) file_get_contents($png), 1, 3) === 'PNG', 'renderer deve produzir um PNG válido');

    $fit_text_height = new ReflectionMethod(Kodety_Social_Images::class, 'fit_text_height');
    $fitted_height = $fit_text_height->invoke(
        $service,
        str_repeat('Conteúdo dinâmico ', 16),
        $layout_text,
        636,
        582
    );
    kodety_social_assert(
        is_int($fitted_height) && $fitted_height > 32 && $fitted_height <= 582,
        'fit-content deve crescer além do fallback sem ultrapassar a área ancorada'
    );
    kodety_social_assert(
        $fit_text_height->invoke($service, '', $layout_text, 636, 582) === 29,
        'texto auto-height vazio deve conservar uma linha como o placeholder do preview'
    );
    kodety_social_assert(
        $fit_text_height->invoke(
            $service,
            str_repeat('Conteúdo dinâmico ', 16),
            $layout_text,
            636,
            40
        ) === 40,
        'texto excedente deve ser cortado no limite disponível do canvas'
    );
    $stack_layer_placements = new ReflectionMethod(
        Kodety_Social_Images::class,
        'stack_layer_placements'
    );
    $stack_placements = $stack_layer_placements->invoke(
        $service,
        $stack_template['layers'],
        $stack_template['stacks'],
        $post,
        1200,
        630
    );
    $stack_title_placement = $stack_placements['stack-title'] ?? [];
    $stack_description_placement = $stack_placements['stack-description'] ?? [];
    kodety_social_assert(
        !is_wp_error($stack_placements)
            && ($stack_description_placement['height'] ?? 0) > 40
            && ($stack_title_placement['y'] ?? 100) < 100,
        'Stack vertical deve mover o título para cima quando a descrição ganha linhas'
    );
    kodety_social_assert(
        ($stack_description_placement['y'] ?? 0)
            - ($stack_title_placement['y'] ?? 0)
            - ($stack_title_placement['height'] ?? 0) === 20,
        'renderer publicado deve conservar exatamente o gap do Stack'
    );
    $wrap_text = new ReflectionMethod(Kodety_Social_Images::class, 'wrap_ttf_text');
    $long_word = str_repeat('Kodety', 40);
    $wrapped_long_word = $wrap_text->invoke(
        $service,
        $long_word,
        $resolved_font,
        18,
        120,
        0
    );
    $ttf_text_width = new ReflectionMethod(Kodety_Social_Images::class, 'ttf_text_width');
    kodety_social_assert(
        count($wrapped_long_word) > 1
            && implode('', $wrapped_long_word) === $long_word
            && count(array_filter(
                $wrapped_long_word,
                static fn(string $line): bool => $ttf_text_width->invoke(
                    $service,
                    $line,
                    $resolved_font,
                    18,
                    0
                ) > 120
            )) === 0,
        'palavras sem espaços devem quebrar por grafema dentro da largura disponível'
    );
    $auto_image = $render->invoke($service, $layout_template, $post);
    kodety_social_assert(!is_wp_error($auto_image), 'renderer deve aceitar texto auto-height com largura percentual e âncoras');
    kodety_social_assert(
        imagesx($auto_image) === 1200 && imagesy($auto_image) === 630,
        'layout responsivo deve continuar produzindo o canvas exato'
    );
    imagedestroy($auto_image);

    $visual_fixture = $sanitize_template->invoke(null, [
        'id' => 'visual-fixture',
        'width' => 64,
        'height' => 64,
        'background' => ['color' => '#112233'],
        'elements' => [
            ['id' => 'box', 'type' => 'shape', 'shape' => 'rectangle', 'x' => 10, 'y' => 10, 'width' => 20, 'height' => 20, 'fill' => '#FF0000'],
            ['id' => 'line', 'type' => 'shape', 'shape' => 'line', 'x' => 0, 'y' => 38, 'width' => 40, 'height' => 4, 'fill' => '#00FF00', 'border' => ['width' => 2]],
            ['id' => 'check', 'type' => 'icon', 'icon' => 'check', 'x' => 44, 'y' => 44, 'width' => 16, 'height' => 16, 'color' => '#FFFFFF'],
        ],
    ]);
    $visual = $render->invoke($service, $visual_fixture, $post);
    kodety_social_assert(!is_wp_error($visual), 'fixture visual determinística deve renderizar');
    $pixel = static function ($image, int $x, int $y): array {
        $color = imagecolorat($image, $x, $y);
        return [($color >> 16) & 0xFF, ($color >> 8) & 0xFF, $color & 0xFF];
    };
    kodety_social_assert($pixel($visual, 0, 0) === [17, 34, 51], 'background sólido deve manter sua cor exata');
    kodety_social_assert($pixel($visual, 15, 15) === [255, 0, 0], 'forma deve ocupar a geometria publicada');
    kodety_social_assert($pixel($visual, 10, 40) === [0, 255, 0], 'linha deve aparecer sem borda retangular externa');
    $icon_changed = false;
    for ($y = 44; $y < 60 && !$icon_changed; $y++) {
        for ($x = 44; $x < 60; $x++) {
            if ($pixel($visual, $x, $y) !== [17, 34, 51]) {
                $icon_changed = true;
                break;
            }
        }
    }
    kodety_social_assert($icon_changed, 'ícone deve produzir pixels visíveis na região atribuída');
    imagedestroy($visual);
}

$theme_runtime_source = (string) file_get_contents(__DIR__ . '/../kodety/theme-runtime/index.php');
kodety_social_assert(
    str_contains($theme_runtime_source, 'if (is_singular()')
        && str_contains($theme_runtime_source, "Kodety_Edition::has('socialImageBuilder')"),
    'metatags sociais geradas devem exigir conteúdo singular e licença ativa'
);
$social_runtime_source = (string) file_get_contents(__DIR__ . '/../kodety/includes/class-kodety-social-images.php');
kodety_social_assert(
    str_contains($social_runtime_source, '$font_size = $css_font_size * self::CSS_PIXEL_TO_POINT;'),
    'fontSize em CSS px deve ser convertido para pontos antes de chamar FreeType'
);
kodety_social_assert(
    !str_contains($social_runtime_source, "'numberposts' => 10000"),
    'regeneração não pode voltar a truncar a fila em 10 mil conteúdos'
);
kodety_social_assert(
    str_contains($social_runtime_source, '$this->invalidate_post_cache($post_id, $new_attachment_id);'),
    'uma nova imagem deve invalidar o cache público do conteúdo'
);
kodety_social_assert(
    str_contains($social_runtime_source, '$width * $height > self::MAX_LAYER_PIXELS'),
    'superfície expandida de sombra deve respeitar o budget de pixels'
);
$source_metadata_ack_position = strpos($social_runtime_source, '$this->assert_source_metadata_checkpoint(');
$source_attachment_swap_position = strpos(
    $social_runtime_source,
    'update_post_meta($post_id, self::META_ATTACHMENT, $new_attachment_id);'
);
kodety_social_assert(
    is_int($source_metadata_ack_position)
        && is_int($source_attachment_swap_position)
        && $source_metadata_ack_position < $source_attachment_swap_position,
    'hash e template devem ser confirmados antes de trocar o attachment público'
);
$source_assignment_ack_position = strpos($social_runtime_source, '$this->assert_source_assignment_checkpoint(');
$previous_attachment_delete_position = strpos(
    $social_runtime_source,
    'wp_delete_attachment($current_attachment, true);'
);
kodety_social_assert(
    is_int($source_assignment_ack_position)
        && is_int($previous_attachment_delete_position)
        && $source_assignment_ack_position < $previous_attachment_delete_position,
    'attachment anterior só pode ser removido depois do ACK completo do novo estado'
);

if (extension_loaded('gd') && function_exists('imagecreatetruecolor')) {
    $transaction_directory = $kodety_social_uploads . '/kodety/social';
    wp_mkdir_p($transaction_directory);
    $previous_transaction_file = $transaction_directory . '/old-post-30.png';
    copy($kodety_social_background_path, $previous_transaction_file);
    $kodety_social_posts[30] = new WP_Post(
        30,
        'product',
        'Café Transacional',
        'cafe-transacional',
        '<p>Imagem anterior deve permanecer ativa até o commit completo.</p>',
        7
    );
    $kodety_social_posts[730] = new WP_Post(
        730,
        'attachment',
        'Social Image anterior',
        'social-image-anterior',
        '',
        7,
        'inherit',
        30,
        'image/png'
    );
    $kodety_social_meta[30] = [
        '_thumbnail_id' => 501,
        '_price' => '149,90',
        '_kodety_social_image_attachment_id' => 730,
        '_kodety_social_image_hash' => 'old-hash',
        '_kodety_social_image_template_id' => 'old-template',
        '_kodety_social_image_error' => 'Erro anterior',
    ];
    $kodety_social_meta[730] = [
        '_kodety_social_generated' => '1',
        '_kodety_social_source_post' => 30,
        '_kodety_social_image_hash' => 'old-hash',
    ];
    $kodety_social_attachment_files[730] = $previous_transaction_file;
    $kodety_social_attachment_metadata[730] = [
        'width' => 1200,
        'height' => 630,
        'file' => 'kodety/social/old-post-30.png',
    ];
    $kodety_social_attachment_mimes[730] = 'image/png';

    $transaction_faults = [
        'attachment_record',
        'attachment_parent',
        'attachment_not_image',
        'attachment_wrong_mime',
        'attached_file',
        'metadata',
        'metadata_dimensions',
        'metadata_file',
        'attachment_ownership',
        'attachment_source',
        'attachment_hash',
        'attachment_alt',
        'post_hash',
        'post_template',
        'post_attachment',
        'post_error_delete',
    ];
    foreach ($transaction_faults as $fault_point) {
        $kodety_social_fault = $fault_point;
        $expected_new_attachment = $kodety_social_next_attachment_id + 1;
        $previous_deletion_count = count(array_filter(
            $kodety_social_deleted_attachments,
            static fn(array $deletion): bool => ($deletion[0] ?? 0) === 730
        ));
        $failed_generation = $service->generate_for_post(30);
        kodety_social_assert(
            is_wp_error($failed_generation),
            "fault {$fault_point} deve abortar a geração"
        );
        kodety_social_assert(
            in_array($fault_point, $kodety_social_fault_hits, true) && $kodety_social_fault === '',
            "fault {$fault_point} deve alcançar seu checkpoint"
        );
        kodety_social_assert(
            absint(get_post_meta(30, '_kodety_social_image_attachment_id', true)) === 730
                && get_post_meta(30, '_kodety_social_image_hash', true) === 'old-hash'
                && get_post_meta(30, '_kodety_social_image_template_id', true) === 'old-template',
            "fault {$fault_point} deve restaurar attachment, hash e template anteriores"
        );
        kodety_social_assert(
            get_post(730) instanceof WP_Post
                && get_attached_file(730) === $previous_transaction_file
                && is_file($previous_transaction_file),
            "fault {$fault_point} deve preservar registro e arquivo anteriores"
        );
        kodety_social_assert(
            count(array_filter(
                $kodety_social_deleted_attachments,
                static fn(array $deletion): bool => ($deletion[0] ?? 0) === 730
            )) === $previous_deletion_count,
            "fault {$fault_point} não pode remover o attachment anterior"
        );
        kodety_social_assert(
            !isset($kodety_social_posts[$expected_new_attachment])
                && !isset($kodety_social_meta[$expected_new_attachment])
                && !isset($kodety_social_attachment_files[$expected_new_attachment])
                && !isset($kodety_social_attachment_metadata[$expected_new_attachment])
                && !isset($kodety_social_attachment_mimes[$expected_new_attachment]),
            "fault {$fault_point} deve remover somente o novo attachment incompleto"
        );
        kodety_social_assert(
            count(glob($transaction_directory . '/post-30-*.png') ?: []) === 0,
            "fault {$fault_point} não pode deixar PNG novo órfão"
        );
    }

    $kodety_social_fault = '';
    $confirmed_attachment = $service->generate_for_post(30);
    kodety_social_assert(
        is_int($confirmed_attachment) && $confirmed_attachment > 0,
        'geração sem fault deve confirmar o novo attachment'
    );
    $confirmed_hash = (string) get_post_meta(30, '_kodety_social_image_hash', true);
    $confirmed_metadata = wp_get_attachment_metadata($confirmed_attachment);
    $confirmed_file = get_attached_file($confirmed_attachment);
    kodety_social_assert(
        absint(get_post_meta(30, '_kodety_social_image_attachment_id', true)) === $confirmed_attachment
            && $confirmed_hash !== ''
            && $confirmed_hash !== 'old-hash'
            && get_post_meta(30, '_kodety_social_image_template_id', true) === 'product-card'
            && get_post_meta(30, '_kodety_social_image_error', true) === '',
        'commit confirmado deve aplicar attachment, hash e template novos e limpar o erro'
    );
    kodety_social_assert(
        get_post_meta($confirmed_attachment, '_kodety_social_generated', true) === '1'
            && absint(get_post_meta($confirmed_attachment, '_kodety_social_source_post', true)) === 30
            && get_post_meta($confirmed_attachment, '_kodety_social_image_hash', true) === $confirmed_hash
            && get_post_meta($confirmed_attachment, '_wp_attachment_image_alt', true) === 'Café Transacional',
        'attachment confirmado deve persistir ownership, source, hash e alt por readback'
    );
    kodety_social_assert(
        is_array($confirmed_metadata)
            && absint($confirmed_metadata['width'] ?? 0) === 1200
            && absint($confirmed_metadata['height'] ?? 0) === 630
            && is_string($confirmed_file)
            && is_file($confirmed_file)
            && basename((string) ($confirmed_metadata['file'] ?? '')) === basename($confirmed_file),
        'attachment confirmado deve manter metadata e arquivo coerentes'
    );
    kodety_social_assert(
        get_post(730) === null
            && !is_file($previous_transaction_file)
            && in_array([730, true], $kodety_social_deleted_attachments, true),
        'attachment anterior só deve ser removido depois do commit confirmado'
    );
}

$retryable = new ReflectionMethod(Kodety_Social_Images::class, 'is_retryable_generation_error');
kodety_social_assert(
    $retryable->invoke($service, new WP_Error('kodety_social_locked', 'locked')) === true,
    'falha transitória deve ser elegível para retry'
);
kodety_social_assert(
    $retryable->invoke($service, new WP_Error('kodety_social_post_missing', 'missing')) === false,
    'conteúdo removido não deve alimentar retries inúteis'
);
$kodety_social_options['kodety_social_image_lock_10'] = time();
$previous_error_log = (string) ini_get('error_log');
ini_set('error_log', $kodety_social_uploads . '/runtime-errors.log');
$service->generate_queued(['post_ids' => [10], 'attempt' => 0]);
ini_set('error_log', $previous_error_log);
unset($kodety_social_options['kodety_social_image_lock_10']);
$retry_events = array_values(array_filter(
    $kodety_social_scheduled_events,
    static fn(array $event): bool => $event['hook'] === 'kodety_social_images_generate'
        && ($event['args'][0]['attempt'] ?? 0) === 1
        && ($event['args'][0]['post_ids'] ?? []) === [10]
));
kodety_social_assert(count($retry_events) === 1, 'worker deve reagendar falhas transitórias com attempt incrementado');
kodety_social_assert(
    ($retry_events[0]['timestamp'] ?? 0) >= time() + 55,
    'retry deve usar backoff em vez de um loop imediato'
);

Kodety_Social_Images::deactivate();
kodety_social_assert(
    in_array('kodety_social_images_generate', $kodety_social_unscheduled_hooks, true)
        && in_array('kodety_social_images_scan', $kodety_social_unscheduled_hooks, true),
    'desativação deve remover todos os hooks assíncronos de imagem social'
);
kodety_social_assert(
    !array_filter(
        $kodety_social_scheduled_events,
        static fn(array $event): bool => in_array(
            $event['hook'],
            ['kodety_social_images_generate', 'kodety_social_images_scan'],
            true
        )
    ),
    'desativação não pode deixar jobs com payload no cron'
);

$invalidate_cache = new ReflectionMethod(Kodety_Social_Images::class, 'invalidate_post_cache');
$invalidate_cache->invoke($service, 10, 700);
kodety_social_assert(in_array(10, $kodety_social_cleaned_posts, true), 'cache padrão do post deve ser invalidado');
kodety_social_assert(in_array(700, $kodety_social_cleaned_attachments, true), 'cache do novo attachment deve ser invalidado');

$kodety_social_posts[11] = new WP_Post(11, 'post', 'Mídia manual', 'midia-manual');
$kodety_social_posts[701] = new WP_Post(701, 'attachment', 'Imagem manual', 'imagem-manual', '', 1, 'inherit');
$kodety_social_meta[11] = ['_kodety_social_image_attachment_id' => 701];
$kodety_social_meta[701] = [];
$service->before_delete_post(11, $kodety_social_posts[11]);
kodety_social_assert(
    !in_array(701, array_column($kodety_social_deleted_attachments, 0), true),
    'cleanup nunca deve remover mídia que não foi gerada pelo Kodety'
);
kodety_social_assert(
    get_post_meta(11, '_kodety_social_image_attachment_id', true) === '',
    'assignment inválido deve ser limpo durante exclusão permanente'
);

$service->before_delete_post(10, $kodety_social_posts[10]);
kodety_social_assert(
    in_array([700, true], $kodety_social_deleted_attachments, true),
    'excluir um conteúdo deve remover permanentemente seu attachment gerado'
);
kodety_social_assert(
    get_post_meta(10, '_kodety_social_image_attachment_id', true) === '',
    'metadados da imagem gerada devem ser limpos com o conteúdo'
);

$kodety_social_posts[12] = new WP_Post(12, 'post', 'Attachment direto', 'attachment-direto');
$kodety_social_posts[702] = new WP_Post(702, 'attachment', 'Social direta', 'social-direta', '', 1, 'inherit');
$kodety_social_meta[12] = ['_kodety_social_image_attachment_id' => 702, '_kodety_social_image_hash' => 'hash'];
$kodety_social_meta[702] = ['_kodety_social_generated' => '1', '_kodety_social_source_post' => 12];
$deleted_before_direct_attachment = count($kodety_social_deleted_attachments);
$service->before_delete_post(702, $kodety_social_posts[702]);
kodety_social_assert(
    count($kodety_social_deleted_attachments) === $deleted_before_direct_attachment,
    'hook não deve excluir novamente o attachment que o WordPress já está removendo'
);
kodety_social_assert(
    get_post_meta(12, '_kodety_social_image_attachment_id', true) === '',
    'excluir o attachment diretamente deve limpar o vínculo do conteúdo'
);

function kodety_social_remove_tree(string $directory): void {
    if (!is_dir($directory)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
    rmdir($directory);
}
kodety_social_remove_tree($project);
kodety_social_remove_tree($kodety_social_theme);
kodety_social_remove_tree($kodety_social_uploads);

echo "Social images runtime OK\n";
