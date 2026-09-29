<?php

/**
 * Isolated contracts for the WordPress role -> Kodety capability matrix.
 *
 * Run with: php Wordpress/tests/role-permissions-runtime.php
 */

define('ABSPATH', __DIR__);

final class WP_Role {
    /** @param array<string,bool> $capabilities */
    public function __construct(public array $capabilities = []) {}
    public function add_cap(string $capability): void { $this->capabilities[$capability] = true; }
    public function remove_cap(string $capability): void { unset($this->capabilities[$capability]); }
}

final class WP_Post_Type {
    public bool $show_ui = true;
    public object $cap;
    public function __construct() {
        $this->cap = (object) [
            'edit_posts' => 'edit_posts',
            'edit_others_posts' => 'edit_others_posts',
            'edit_published_posts' => 'edit_published_posts',
            'read_private_posts' => 'read_private_posts',
            'create_posts' => 'edit_posts',
            'publish_posts' => 'publish_posts',
        ];
    }
}

final class WP_Post {
    public function __construct(public int $ID, public string $post_type = 'page') {}
}

final class WP_Error {}

final class WP_REST_Request implements ArrayAccess {
    /** @param array<string,mixed> $route @param array<string,mixed> $params */
    public function __construct(private array $route = [], private array $params = []) {}
    public function get_param(string $key): mixed { return $this->params[$key] ?? null; }
    public function offsetExists(mixed $offset): bool { return isset($this->route[$offset]); }
    public function offsetGet(mixed $offset): mixed { return $this->route[$offset] ?? null; }
    public function offsetSet(mixed $offset, mixed $value): void { $this->route[$offset] = $value; }
    public function offsetUnset(mixed $offset): void { unset($this->route[$offset]); }
}

final class WP_REST_Response {
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function get_data(): mixed { return $this->data; }
}

final class WP_Query {
    /** @var list<WP_Post> */
    public array $posts = [];
    public int $found_posts = 0;
    public int $max_num_pages = 0;
    /** @param array<string,mixed> $arguments */
    public function __construct(array $arguments) {
        global $kodety_role_test_last_query;
        $kodety_role_test_last_query = $arguments;
    }
}

$editor_caps = [
    'read' => true,
    'edit_posts' => true,
    'edit_others_posts' => true,
    'edit_published_posts' => true,
    'read_private_posts' => true,
    'publish_posts' => true,
    'delete_posts' => true,
    'edit_pages' => true,
    'upload_files' => true,
];
$kodety_role_test_roles = [
    'administrator' => new WP_Role($editor_caps + ['manage_options' => true, 'edit_theme_options' => true]),
    'editor' => new WP_Role($editor_caps + [
        'kodety_edit' => true,
        'kodety_manage_cms' => true,
        'kodety_manage_analytics' => true,
        'kodety_publish' => true,
        'kodety_import' => true,
    ]),
    'author' => new WP_Role([
        'read' => true,
        'edit_posts' => true,
        'edit_published_posts' => true,
        'publish_posts' => true,
        'delete_posts' => true,
        'upload_files' => true,
    ]),
    'contributor' => new WP_Role(['read' => true, 'edit_posts' => true, 'delete_posts' => true]),
    'subscriber' => new WP_Role(['read' => true]),
];
$kodety_role_test_current_role = 'administrator';
$kodety_role_test_last_query = [];
$kodety_role_test_post_meta = [];

function get_role(string $name): ?WP_Role {
    global $kodety_role_test_roles;
    return $kodety_role_test_roles[$name] ?? null;
}
function add_role(string $name, string $label, array $capabilities): WP_Role {
    global $kodety_role_test_roles;
    return $kodety_role_test_roles[$name] = new WP_Role($capabilities);
}
function remove_role(string $name): void {}
function current_user_can(string $capability, mixed ...$arguments): bool {
    global $kodety_role_test_current_role;
    return !empty(get_role($kodety_role_test_current_role)?->capabilities[$capability]);
}
function get_current_user_id(): int { return 42; }
function get_option(string $name, mixed $default = false): mixed { return $default; }
function get_post_meta(int $post_id, string $key, bool $single = false): mixed {
    global $kodety_role_test_post_meta;
    return $kodety_role_test_post_meta[$post_id][$key] ?? ($single ? '' : []);
}
function get_post_type_object(string $post_type): ?WP_Post_Type {
    return $post_type === 'post' ? new WP_Post_Type() : null;
}
function home_url(string $path = ''): string { return 'https://example.test/' . ltrim($path, '/'); }
function add_query_arg(mixed $key, mixed $value = null, mixed $url = null): string {
    $arguments = is_array($key) ? $key : [(string) $key => $value];
    $target = is_array($key) ? (string) $value : (string) $url;
    return $target . (str_contains($target, '?') ? '&' : '?') . http_build_query($arguments);
}
function esc_attr(string $value): string { return htmlspecialchars($value, ENT_QUOTES); }
function esc_url(string $value): string { return $value; }
function esc_html(string $value): string { return htmlspecialchars($value, ENT_QUOTES); }
function sanitize_key(string $value): string { return preg_replace('/[^a-z0-9_-]/', '', strtolower($value)) ?: ''; }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function absint(mixed $value): int { return abs((int) $value); }
function add_action(...$arguments): void {}
function add_filter(...$arguments): void {}

require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_role_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}
function kodety_role_has(string $role, string $capability): bool {
    return !empty(get_role($role)?->capabilities[$capability]);
}

Kodety_Plugin::install_roles_and_capabilities();
Kodety_Plugin::install_roles_and_capabilities();

foreach ([
    Kodety_Plugin::CAP_EDIT_WORKSPACE,
    Kodety_Plugin::CAP_ACCESS_CMS,
    Kodety_Plugin::CAP_MANAGE_CMS_SCHEMA,
    Kodety_Plugin::CAP_MANAGE_CMS_TEMPLATES,
    Kodety_Plugin::CAP_USE_AI,
    Kodety_Plugin::CAP_VIEW_ANALYTICS,
    Kodety_Plugin::CAP_MANAGE_ANALYTICS,
    'kodety_publish',
    'kodety_import',
] as $capability) {
    kodety_role_assert(kodety_role_has('administrator', $capability), "administrador deve possuir {$capability}");
}

kodety_role_assert(get_role(Kodety_Plugin::ROLE_DESIGNER) instanceof WP_Role, 'papel Kodety Designer deve ser criado');
kodety_role_assert(kodety_role_has(Kodety_Plugin::ROLE_DESIGNER, 'edit_pages'), 'Designer deve herdar edição editorial');
kodety_role_assert(kodety_role_has(Kodety_Plugin::ROLE_DESIGNER, Kodety_Plugin::CAP_EDIT_WORKSPACE), 'Designer deve editar workspace');
kodety_role_assert(kodety_role_has(Kodety_Plugin::ROLE_DESIGNER, Kodety_Plugin::CAP_MANAGE_CMS_SCHEMA), 'Designer deve gerenciar schema');
kodety_role_assert(!kodety_role_has(Kodety_Plugin::ROLE_DESIGNER, 'kodety_publish'), 'Designer não deve publicar o site');

kodety_role_assert(kodety_role_has('editor', Kodety_Plugin::CAP_ACCESS_CMS), 'Editor deve acessar CMS');
kodety_role_assert(kodety_role_has('editor', Kodety_Plugin::CAP_EDIT_WORKSPACE), 'Editor deve acessar o Builder');
kodety_role_assert(kodety_role_has('editor', Kodety_Plugin::CAP_VIEW_ANALYTICS), 'Editor deve visualizar Analytics');
kodety_role_assert(kodety_role_has('editor', Kodety_Plugin::CAP_USE_AI), 'Editor deve usar AI editorial');
foreach ([
    Kodety_Plugin::CAP_MANAGE_CMS_SCHEMA,
    Kodety_Plugin::CAP_MANAGE_CMS_TEMPLATES,
    Kodety_Plugin::CAP_MANAGE_ANALYTICS,
    'kodety_manage_cms',
    'kodety_publish',
    'kodety_import',
] as $capability) {
    kodety_role_assert(!kodety_role_has('editor', $capability), "Editor não deve possuir {$capability}");
}

$schema_version = (new ReflectionClass(Kodety_Plugin::class))
    ->getReflectionConstant('SCHEMA_VERSION')
    ?->getValue();
kodety_role_assert(
    is_int($schema_version) && $schema_version >= 12,
    'schema deve migrar instalações existentes para a nova capacidade do Editor'
);

foreach (['author', 'contributor'] as $role) {
    kodety_role_assert(kodety_role_has($role, Kodety_Plugin::CAP_ACCESS_CMS), "{$role} deve acessar CMS");
    kodety_role_assert(!kodety_role_has($role, Kodety_Plugin::CAP_EDIT_WORKSPACE), "{$role} não deve editar workspace");
    kodety_role_assert(!kodety_role_has($role, Kodety_Plugin::CAP_MANAGE_CMS_SCHEMA), "{$role} não deve gerenciar schema");
}
kodety_role_assert(!kodety_role_has('subscriber', Kodety_Plugin::CAP_ACCESS_CMS), 'Assinante não deve acessar CMS');

$plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();
$kodety_role_test_current_role = 'editor';
$kodety_role_test_post_meta[501] = [
    '_kodety_managed' => '1',
    '_kodety_html_path' => 'pages/cases.html',
];
$page_actions = $plugin->page_row_actions([
    'edit' => 'Edit',
    'inline hide-if-no-js' => 'Quick Edit',
    'trash' => 'Trash',
], new WP_Post(501));
kodety_role_assert(
    isset($page_actions['kodety_edit'])
    && !isset($page_actions['edit'])
    && !isset($page_actions['inline hide-if-no-js'])
    && str_contains($page_actions['kodety_edit'], 'kodety_html=pages%2Fcases.html'),
    'Editor deve ver apenas Editar no Kodety em páginas gerenciadas'
);

$kodety_role_test_post_meta[502] = ['_kodety_managed' => '1'];
$partial_page_actions = $plugin->page_row_actions([
    'edit' => 'Edit',
    'inline hide-if-no-js' => 'Quick Edit',
], new WP_Post(502));
kodety_role_assert(
    isset($partial_page_actions['kodety_edit'])
    && !isset($partial_page_actions['edit'])
    && !isset($partial_page_actions['inline hide-if-no-js']),
    'página marcada como Kodety deve permanecer protegida mesmo sem metadado de caminho'
);

$kodety_role_test_current_role = 'author';
$plugin->cms_items(new WP_REST_Request(['post_type' => 'post']));
kodety_role_assert(
    ($kodety_role_test_last_query['author'] ?? 0) === 42,
    'Autor deve consultar somente itens próprios'
);
kodety_role_assert(
    !in_array('private', $kodety_role_test_last_query['post_status'] ?? [], true),
    'Autor não deve consultar conteúdo privado'
);

$kodety_role_test_current_role = 'contributor';
$plugin->cms_items(new WP_REST_Request(['post_type' => 'post']));
kodety_role_assert(
    ($kodety_role_test_last_query['post_status'] ?? []) === ['draft', 'pending'],
    'Colaborador deve consultar somente rascunhos e pendentes editáveis'
);

$kodety_role_test_current_role = 'editor';
$plugin->cms_items(new WP_REST_Request(['post_type' => 'post']));
kodety_role_assert(
    !isset($kodety_role_test_last_query['author']),
    'Editor deve consultar conteúdo de todos os autores'
);
kodety_role_assert(
    in_array('private', $kodety_role_test_last_query['post_status'] ?? [], true),
    'Editor deve consultar conteúdo privado autorizado'
);

$plugin_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php');
$editor_shell_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/templates/editor-shell.php');
kodety_role_assert(
    preg_match(
        '/public function admin_import\(\): void \{[\s\S]*?!current_user_can\(\'kodety_import\'\) \|\| !\$this->can_publish\(\)[\s\S]*?\$this->stage_builder_import\(/',
        $plugin_source
    ) === 1,
    'importação ZIP entregue ao Builder para build e publicação deve exigir importação e publicação'
);
kodety_role_assert(
    preg_match(
        '/public function admin_import\(\): void \{[\s\S]*?\$this->stage_builder_import\([\s\S]*?kodety_open_publish[\s\S]*?home_url\(\'\/kodety\/editor\/\'\)/',
        $plugin_source
    ) === 1,
    'importação ZIP administrativa deve salvar o workspace e abrir a revisão manual de publicação'
);
kodety_role_assert(
    preg_match(
        '/public function admin_import_url\(\): void \{[\s\S]*?\$elementor_request \? current_user_can\(self::CAP_EDIT_WORKSPACE\) : \(bool\) \$this->can_publish\(\)[\s\S]*?\$this->install_zip\(/',
        $plugin_source
    ) === 1,
    'importação por URL deve exigir edição para rascunho Elementor e publicação para origens que ativam tema'
);
kodety_role_assert(
    preg_match(
        '/public function admin_import_url\(\): void \{[\s\S]*?if \(\$elementor_request && \$elementor_mode === \'native\'\)[\s\S]*?\$this->stage_builder_import\([\s\S]*?\$draft_mode = \'native\'[\s\S]*?\$result_platform = \(string\) \(\$result\[\'platform\'\] \?\? \'\'\)[\s\S]*?if \(\$result_platform === \'elementor\'\)[\s\S]*?\$this->stage_builder_import\([\s\S]*?\$draft_mode = \'visual\'[\s\S]*?else \{[\s\S]*?\$this->install_zip\(/',
        $plugin_source
    ) === 1,
    'os dois modos Elementor devem parar no workspace privado e nunca passar pela instalação publicadora'
);
kodety_role_assert(
    preg_match(
        '/public function admin_import_url\(\): void \{[\s\S]*?\$elementor_request && \$rendered_html !== \'\'[\s\S]*?\$elementor_request && \$result_platform !== \'elementor\'[\s\S]*?if \(!\$this->can_publish\(\)\)[\s\S]*?\$this->install_zip\(/',
        $plugin_source
    ) === 1,
    'rótulo Elementor forjado ou captura incompatível não pode contornar a autorização final de publicação'
);
kodety_role_assert(
    preg_match(
        '/private function elementor_import_post_id_from_url\([\s\S]*?current_user_can\(\'edit_post\', \$post_id\)[\s\S]*?get_post_meta\(\$post_id, \'_elementor_data\'/',
        $plugin_source
    ) === 1,
    'conversão nativa deve autorizar a página antes de ler metadados Elementor privados'
);
kodety_role_assert(
    preg_match(
        '/private function stage_builder_import\([^)]*bool \$reset_project_id = false[\s\S]*?with_workspace_lock\([\s\S]*?assert_admin_import_workspace_revision\(\$expected_revision, \$request\)[\s\S]*?update_option\(\x27kodety_workspace_revision\x27, \$current_revision \+ 1/',
        $plugin_source
    ) === 1
    && str_contains($plugin_source, "stage_builder_import(\$zip_path, 'elementor-' . \$post_id . '-nativo.zip', true, \$import_revision)"),
    'importação administrativa compara revisão dentro do commit atômico e preserva alterações feitas durante a captura'
);
kodety_role_assert(
    str_contains($plugin_source, "current_user_can('kodety_import') && \$this->can_publish()"),
    'painel administrativo de importar e publicar deve ficar oculto sem permissão de publicação'
);
kodety_role_assert(
    str_contains($editor_shell_source, "'importZipUrl' => \$can_publish && current_user_can('kodety_import')"),
    'atalho do Builder para o importador publicador não deve ser anunciado a Designer'
);
kodety_role_assert(
    preg_match(
        '/public function replace_asset\(\): void \{[\s\S]*?if \(!\$this->can_publish\(\)\)[\s\S]*?\$this->replace_files_atomically\(/',
        $plugin_source
    ) === 1,
    'substituição de mídia que escreve no tema ativo deve exigir publicação'
);
kodety_role_assert(
    preg_match(
        '/public function attachment_fields_to_edit\([\s\S]*?!\$this->can_publish\(\)[\s\S]*?public function replace_asset_page\(\): void \{[\s\S]*?if \(!\$this->can_publish\(\)\)/',
        $plugin_source
    ) === 1,
    'atalho e tela de substituição do asset publicado devem ficar indisponíveis sem publicação'
);

echo "Kodety role permission contracts passed.\n";
