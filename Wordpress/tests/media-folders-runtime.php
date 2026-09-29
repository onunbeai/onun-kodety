<?php

/**
 * Execute the production media-folder callbacks against an in-memory WordPress
 * taxonomy fixture. No installed site, disk folders or live media are changed.
 * Run with: php Wordpress/tests/media-folders-runtime.php
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');

final class WP_Error {
    public function __construct(private string $code, private string $message = '', private mixed $data = null) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

final class WP_REST_Response {
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function get_data(): mixed { return $this->data; }
    public function get_status(): int { return $this->status; }
}

final class WP_REST_Request implements ArrayAccess {
    public function __construct(private array $params = []) {}
    public function get_param(string $name): mixed { return $this->params[$name] ?? null; }
    public function offsetExists(mixed $offset): bool { return isset($this->params[$offset]); }
    public function offsetGet(mixed $offset): mixed { return $this->params[$offset] ?? null; }
    public function offsetSet(mixed $offset, mixed $value): void { $this->params[$offset] = $value; }
    public function offsetUnset(mixed $offset): void { unset($this->params[$offset]); }
}

final class WP_Term {
    public function __construct(public int $term_id, public string $name, public int $parent = 0, public int $count = 0) {}
}

$media_folder_routes = [];
$media_folder_taxonomies = [];
$media_folder_terms = [];
$media_folder_assignments = [];
$media_folder_next_id = 1;
$media_folder_caps = ['upload_files' => true, 'manage_categories' => true];
$media_folder_posts = [101 => 'attachment', 102 => 'attachment', 103 => 'attachment', 104 => 'post'];
$media_folder_editable = [101 => true, 102 => true, 103 => false, 104 => true];
$media_folder_fail_insert = false;
$media_folder_fail_update = false;
$media_folder_fail_read = false;
$media_folder_fail_list = false;
$media_folder_fail_assign = [];
$media_folder_checks = 0;
$media_folder_rest_fields = [];
$media_folder_fixture_directory = sys_get_temp_dir() . '/kodety-media-folder-test-' . bin2hex(random_bytes(6));
register_shutdown_function(static function (): void {
    $root = $GLOBALS['media_folder_fixture_directory'];
    @unlink($root . '/kodety/private/.media-folders.lock');
    @rmdir($root . '/kodety/private');
    @rmdir($root . '/kodety');
    @rmdir($root);
});

function add_action(...$args): void {}
function add_filter(...$args): void {}
function register_rest_field(string $type, string $field, array $args): void { $GLOBALS['media_folder_rest_fields'][$field] = $args; }
function wp_json_encode(mixed $value): string { return json_encode($value, JSON_THROW_ON_ERROR); }
function wp_get_upload_dir(): array { return ['basedir' => $GLOBALS['media_folder_fixture_directory']]; }
function trailingslashit(string $value): string { return rtrim($value, '/') . '/'; }
function wp_mkdir_p(string $directory): bool { return is_dir($directory) || mkdir($directory, 0700, true); }
function wp_cache_delete(...$args): void {}
function clean_term_cache(...$args): void {}
function clean_object_term_cache(...$args): void {}
function wp_get_object_terms(int $id, string $taxonomy, array $args): array { return $GLOBALS['media_folder_assignments'][$id] ?? []; }
function get_objects_in_term(int $id, string $taxonomy): array {
    return array_keys(array_filter($GLOBALS['media_folder_assignments'], static fn(array $ids): bool => in_array($id, $ids, true)));
}
function register_taxonomy(string $name, array $types, array $args): void {
    $GLOBALS['media_folder_taxonomies'][$name] = ['types' => $types, 'args' => $args];
}
function register_rest_route(string $namespace, string $route, array $args): void {
    $GLOBALS['media_folder_routes']['/' . $namespace . $route] = isset($args['methods']) ? [$args] : $args;
}
function current_user_can(string $capability, mixed ...$args): bool {
    return $capability === 'edit_post'
        ? !empty($GLOBALS['media_folder_editable'][(int) ($args[0] ?? 0)])
        : !empty($GLOBALS['media_folder_caps'][$capability]);
}
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function absint(mixed $value): int { return abs((int) $value); }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function term_exists(int $id, string $taxonomy): ?array {
    return $taxonomy === 'kodety_media_folder' && isset($GLOBALS['media_folder_terms'][$id]) ? ['term_id' => $id] : null;
}
function wp_insert_term(string $name, string $taxonomy, array $args): array|WP_Error {
    if (!isset($GLOBALS['media_folder_taxonomies'][$taxonomy])) return new WP_Error('invalid_taxonomy');
    if ($GLOBALS['media_folder_fail_insert']) return new WP_Error('db_insert_error', 'Falha de gravação simulada.');
    foreach ($GLOBALS['media_folder_terms'] as $term) {
        if ($term->parent === $args['parent'] && $term->name === $name) return new WP_Error('term_exists', 'Pasta já existente.');
    }
    $id = $GLOBALS['media_folder_next_id']++;
    $GLOBALS['media_folder_terms'][$id] = new WP_Term($id, $name, $args['parent']);
    return ['term_id' => $id, 'term_taxonomy_id' => $id];
}
function get_term(int $id, string $taxonomy): ?WP_Term {
    if ($GLOBALS['media_folder_fail_read']) return null;
    return term_exists($id, $taxonomy) ? $GLOBALS['media_folder_terms'][$id] : null;
}
function get_terms(array $args): array|WP_Error {
    if ($GLOBALS['media_folder_fail_list']) return new WP_Error('invalid_taxonomy', 'Falha de leitura simulada.');
    if (($args['fields'] ?? '') === 'ids') {
        return array_keys(array_filter($GLOBALS['media_folder_terms'], static fn(WP_Term $term): bool => $term->parent === $args['parent']));
    }
    media_folder_assert($args === ['taxonomy' => 'kodety_media_folder', 'hide_empty' => false, 'orderby' => 'name', 'order' => 'ASC'], 'listagem inclui pastas vazias em ordem alfabética');
    $terms = array_values($GLOBALS['media_folder_terms']);
    usort($terms, static fn(WP_Term $a, WP_Term $b): int => strcmp($a->name, $b->name));
    return $terms;
}
function wp_update_term(int $id, string $taxonomy, array $args): array|WP_Error {
    if ($GLOBALS['media_folder_fail_update']) return new WP_Error('db_update_error', 'Falha de atualização simulada.');
    if (!term_exists($id, $taxonomy)) return new WP_Error('invalid_term');
    $GLOBALS['media_folder_terms'][$id]->name = $args['name'];
    return ['term_id' => $id];
}
function wp_delete_term(int $id, string $taxonomy): bool {
    if (!term_exists($id, $taxonomy)) return false;
    $parent = $GLOBALS['media_folder_terms'][$id]->parent;
    foreach ($GLOBALS['media_folder_terms'] as $term) if ($term->parent === $id) $term->parent = $parent;
    foreach ($GLOBALS['media_folder_assignments'] as &$ids) $ids = array_values(array_diff($ids, [$id]));
    unset($ids, $GLOBALS['media_folder_terms'][$id]);
    return true;
}
function get_post_type(int $id): string|false { return $GLOBALS['media_folder_posts'][$id] ?? false; }
function wp_set_object_terms(int $id, array $terms, string $taxonomy, bool $append): array|WP_Error {
    media_folder_assert($taxonomy === 'kodety_media_folder' && !$append, 'mover substitui a pasta em vez de adicionar associações');
    if (!empty($GLOBALS['media_folder_fail_assign'][$id])) return new WP_Error('db_insert_error', 'Associação indisponível.');
    $GLOBALS['media_folder_assignments'][$id] = $terms;
    foreach ($GLOBALS['media_folder_terms'] as $term) {
        $term->count = count(array_filter($GLOBALS['media_folder_assignments'], static fn(array $ids): bool => in_array($term->term_id, $ids, true)));
    }
    return $terms;
}

function media_folder_assert(bool $condition, string $message): void {
    $GLOBALS['media_folder_checks']++;
    if (!$condition) throw new RuntimeException($message);
}
function media_folder_error(mixed $response, string $code, int $status): void {
    media_folder_assert($response instanceof WP_Error && $response->get_error_code() === $code && ($response->get_error_data()['status'] ?? null) === $status, $code . ' deve retornar status ' . $status);
}

/** Apply the permission callback registered by the production class. */
function media_folder_dispatch(string $method, string $route, array $params = []): WP_REST_Response|WP_Error {
    // Ordinary sequential test calls use the last observed resource version.
    // Explicit null/stale values below exercise missing/concurrent baselines.
    if (preg_match('~/media-folders/(\d+)$~', $route, $resource) && isset($GLOBALS['media_folder_terms'][(int) $resource[1]])) {
        $term = $GLOBALS['media_folder_terms'][(int) $resource[1]];
        $payload = (new ReflectionMethod(Kodety_Media::class, 'folder_payload'))->invoke($GLOBALS['media'], $term);
        if ($method === 'POST' && !array_key_exists('expectedRevision', $params)) $params['expectedRevision'] = $payload['revision'];
        if ($method === 'DELETE' && !array_key_exists('expectedDeleteRevision', $params)) $params['expectedDeleteRevision'] = $payload['deleteRevision'];
    }
    if (str_ends_with($route, '/move') && !array_key_exists('expectedFolders', $params)) {
        $params['expectedFolders'] = [];
        foreach (($params['ids'] ?? []) as $id) $params['expectedFolders'][(int) $id] = $GLOBALS['media_folder_assignments'][(int) $id] ?? [];
    }
    foreach ($GLOBALS['media_folder_routes'] as $pattern => $handlers) {
        if (!preg_match('~^' . $pattern . '$~', $route, $matches)) continue;
        foreach ($handlers as $handler) {
            if ($handler['methods'] !== $method) continue;
            foreach ($matches as $key => $value) if (is_string($key)) $params[$key] = $value;
            $request = new WP_REST_Request($params);
            if (!($handler['permission_callback'])($request)) return new WP_Error('rest_forbidden', 'Sem permissão.', ['status' => 403]);
            return ($handler['callback'])($request);
        }
    }
    throw new RuntimeException('Rota não registrada: ' . $method . ' ' . $route);
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-media.php';
$media = Kodety_Media::instance();
$media->register_folder_taxonomy();
$media->register_folder_routes();
$base = '/kodety/v1/media-folders';
media_folder_assert($media_folder_taxonomies['kodety_media_folder']['types'] === ['attachment'], 'pastas usam a taxonomia dos anexos');
media_folder_assert($media_folder_taxonomies['kodety_media_folder']['args']['hierarchical'] === true, 'pastas aceitam hierarquia');
media_folder_assert(media_folder_dispatch('GET', $base)->get_data() === [], 'biblioteca começa sem pastas');

$created = media_folder_dispatch('POST', $base, ['name' => '  Clientes  ']);
media_folder_assert($created->get_status() === 201 && array_intersect_key($created->get_data(), array_flip(['id', 'name', 'parent', 'count'])) === ['id' => 1, 'name' => 'Clientes', 'parent' => 0, 'count' => 0], 'criação retorna ID persistido, nome normalizado e status 201');
media_folder_assert(strlen($created->get_data()['revision']) === 64 && strlen($created->get_data()['deleteRevision']) === 64, 'leituras entregam revisões de edição e exclusão');
$child = media_folder_dispatch('POST', $base, ['name' => 'Banners', 'parent' => 1]);
media_folder_assert($child->get_data()['parent'] === 1, 'subpasta preserva a pasta superior');
$second = media_folder_dispatch('POST', $base, ['name' => 'Avulsos']);
media_folder_assert(array_column(media_folder_dispatch('GET', $base)->get_data(), 'name') === ['Avulsos', 'Banners', 'Clientes'], 'pastas criadas ficam disponíveis na próxima listagem');
media_folder_error(media_folder_dispatch('POST', $base, ['name' => '   ']), 'kodety_folder_name', 400);
media_folder_error(media_folder_dispatch('POST', $base, ['name' => 'Outra', 'parent' => 999]), 'kodety_folder_parent', 404);
media_folder_error(media_folder_dispatch('POST', $base, ['name' => 'Clientes']), 'kodety_folder_create', 400);
media_folder_assert(count($media_folder_terms) === 3, 'requisições inválidas não criam pastas');

$renamed = media_folder_dispatch('POST', $base . '/1', ['name' => 'Clientes ativos']);
media_folder_assert($renamed->get_data()['id'] === 1 && $media_folder_terms[1]->name === 'Clientes ativos', 'renomear preserva a identidade da pasta');
media_folder_assert($media_folder_terms[2]->parent === 1, 'renomear preserva subpastas');
media_folder_error(media_folder_dispatch('POST', $base . '/1', ['name' => '']), 'kodety_folder_name', 400);
media_folder_error(media_folder_dispatch('POST', $base . '/999', ['name' => 'Inválida']), 'kodety_folder_missing', 404);

$moved = media_folder_dispatch('POST', $base . '/move', ['ids' => [101, 101, 102, 0, 103, 104, 999], 'folder_id' => 1]);
media_folder_assert($moved->get_data() === ['moved' => 2, 'failed' => [103, 104, 999]], 'mover deduplica IDs e separa anexos permitidos, proibidos e inexistentes');
media_folder_assert($media_folder_assignments === [101 => [1], 102 => [1]], 'somente anexos permitidos recebem associação');
media_folder_assert(media_folder_dispatch('GET', $base)->get_data()[2]['count'] === 2, 'listagem entrega contagem atualizada da pasta');
media_folder_error(media_folder_dispatch('POST', $base . '/move', ['ids' => []]), 'kodety_media_ids', 400);
media_folder_error(media_folder_dispatch('POST', $base . '/move', ['ids' => [101], 'folder_id' => 999]), 'kodety_folder_missing', 404);
media_folder_dispatch('POST', $base . '/move', ['ids' => [101], 'folder_id' => 2]);
media_folder_assert($media_folder_assignments[101] === [2], 'mover para outra pasta remove a associação anterior');
media_folder_dispatch('POST', $base . '/move', ['ids' => [101], 'folder_id' => 0]);
media_folder_assert($media_folder_assignments[101] === [], 'Sem pasta remove a associação');
$media_folder_fail_assign[102] = true;
media_folder_assert(media_folder_dispatch('POST', $base . '/move', ['ids' => [102], 'folder_id' => 2])->get_data() === ['moved' => 0, 'failed' => [102]], 'falha de armazenamento não é reportada como movimento concluído');
$media_folder_fail_assign = [];

$existing_query = [['taxonomy' => 'other', 'terms' => [8]]];
$filtered = $media->filter_media_by_folder(['tax_query' => $existing_query], new WP_REST_Request(['kodety_folder' => '2']));
media_folder_assert($filtered['tax_query'] === [...$existing_query, ['taxonomy' => 'kodety_media_folder', 'field' => 'term_id', 'terms' => [2], 'include_children' => false]], 'filtro seleciona a pasta exata e preserva condições existentes');
media_folder_assert($media->filter_media_by_folder([], new WP_REST_Request(['kodety_folder' => '0']))['tax_query'] === [['taxonomy' => 'kodety_media_folder', 'operator' => 'NOT EXISTS']], 'Sem pasta filtra anexos sem associação');
media_folder_assert($media->filter_media_by_folder([], new WP_REST_Request()) === [], 'Todos não aplica filtro de pasta');

$media_folder_caps['manage_categories'] = false;
foreach ([['POST', $base, ['name' => 'Proibida']], ['POST', $base . '/1', ['name' => 'Proibida']], ['DELETE', $base . '/1', []]] as [$method, $route, $params]) {
    media_folder_error(media_folder_dispatch($method, $route, $params), 'rest_forbidden', 403);
}
media_folder_assert(count(media_folder_dispatch('GET', $base)->get_data()) === 3, 'usuário com upload pode consultar as pastas sem gerenciá-las');
media_folder_assert(media_folder_dispatch('POST', $base . '/move', ['ids' => [101], 'folder_id' => 2])->get_data()['moved'] === 1, 'usuário com upload pode organizar os anexos que tem permissão de editar');
$media_folder_caps['upload_files'] = false;
foreach ([['GET', $base, []], ['POST', $base . '/move', ['ids' => [101], 'folder_id' => 1]], ['POST', $base, ['name' => 'Proibida']]] as [$method, $route, $params]) {
    media_folder_error(media_folder_dispatch($method, $route, $params), 'rest_forbidden', 403);
}
$media_folder_caps = ['upload_files' => true, 'manage_categories' => true];

$media_folder_fail_insert = true;
media_folder_error(media_folder_dispatch('POST', $base, ['name' => 'Erro']), 'kodety_folder_create', 400);
$media_folder_fail_insert = false;
$media_folder_fail_update = true;
media_folder_error(media_folder_dispatch('POST', $base . '/1', ['name' => 'Erro']), 'kodety_folder_update', 400);
$media_folder_fail_update = false;
$media_folder_fail_read = true;
media_folder_error(media_folder_dispatch('POST', $base, ['name' => 'Recuperável']), 'kodety_folder_read', 500);
$media_folder_fail_read = false;
media_folder_assert(count($media_folder_terms) === 4, 'pasta persistida antes de falha de recarga continua recuperável');
$media_folder_fail_list = true;
media_folder_assert(media_folder_dispatch('GET', $base)->get_status() === 500, 'erro de consulta é distinguido de lista vazia');
$media_folder_fail_list = false;

$posts_before_delete = $media_folder_posts;
// Independent resources combine, but an old snapshot of the same resource
// cannot silently replace a concurrent name, move or deletion decision.
$folder_snapshot = (new ReflectionMethod(Kodety_Media::class, 'folder_payload'))->invoke($media, $media_folder_terms[1]);
media_folder_dispatch('POST', $base . '/3', ['name' => 'Outra pasta editada']);
media_folder_assert(media_folder_dispatch('POST', $base . '/1', ['name' => 'Nome concorrente', 'expectedRevision' => $folder_snapshot['revision']]) instanceof WP_REST_Response, 'edição de pasta diferente não invalida esta pasta');
media_folder_error(media_folder_dispatch('POST', $base . '/1', ['name' => 'Nome obsoleto', 'expectedRevision' => $folder_snapshot['revision']]), 'kodety_folder_conflict', 409);
media_folder_error(media_folder_dispatch('POST', $base . '/1', ['name' => 'Sem baseline', 'expectedRevision' => null]), 'kodety_folder_conflict', 409);
media_folder_error(media_folder_dispatch('DELETE', $base . '/1', ['expectedDeleteRevision' => $folder_snapshot['deleteRevision']]), 'kodety_folder_conflict', 409);
media_folder_assert($media_folder_terms[1]->name === 'Nome concorrente', 'nome concorrente permanece intacto após conflito');
$before_move = $media_folder_assignments[101];
media_folder_dispatch('POST', $base . '/move', ['ids' => [101], 'folder_id' => 1]);
media_folder_error(media_folder_dispatch('POST', $base . '/move', ['ids' => [101], 'folder_id' => 0, 'expectedFolders' => [101 => $before_move]]), 'kodety_media_folder_conflict', 409);
media_folder_assert($media_folder_assignments[101] === [1], 'movimento obsoleto não desfaz a organização concorrente');
media_folder_error(media_folder_dispatch('POST', $base . '/move', ['ids' => [101], 'folder_id' => 0, 'expectedFolders' => []]), 'kodety_media_folder_conflict', 409);
media_folder_dispatch('POST', $base . '/move', ['ids' => [101], 'folder_id' => 2]);
$before_swap = (new ReflectionMethod(Kodety_Media::class, 'folder_payload'))->invoke($media, $media_folder_terms[1]);
wp_set_object_terms(102, [], 'kodety_media_folder', false);
wp_set_object_terms(101, [1], 'kodety_media_folder', false);
media_folder_assert($media_folder_terms[1]->count === $before_swap['count'], 'troca de membros mantém a mesma contagem');
media_folder_error(media_folder_dispatch('DELETE', $base . '/1', ['expectedDeleteRevision' => $before_swap['deleteRevision']]), 'kodety_folder_conflict', 409);
media_folder_assert(isset($media_folder_terms[1]) && $media_folder_assignments[101] === [1], 'exclusão obsoleta não apaga relações com IDs diferentes e mesma contagem');
wp_set_object_terms(101, [2], 'kodety_media_folder', false);
wp_set_object_terms(102, [1], 'kodety_media_folder', false);
$deleted = media_folder_dispatch('DELETE', $base . '/1');
media_folder_assert($deleted->get_data() === ['deleted' => true, 'id' => 1], 'excluir retorna confirmação do ID');
media_folder_assert(!isset($media_folder_terms[1]) && $media_folder_assignments[102] === [], 'excluir remove a pasta e suas associações');
media_folder_assert($media_folder_posts === $posts_before_delete && $media_folder_assignments[101] === [2], 'excluir a pasta conserva arquivos e associações de outras pastas');
media_folder_error(media_folder_dispatch('DELETE', $base . '/1'), 'kodety_folder_delete', 404);
media_folder_assert(!in_array(1, array_column(media_folder_dispatch('GET', $base)->get_data(), 'id'), true), 'pasta excluída desaparece da listagem');

echo 'Media folders: ' . $media_folder_checks . " checks passed (CRUD, hierarchy, moves, permissions, storage errors and resource concurrency).\n";
