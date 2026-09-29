<?php
/** Executable inventory/HTTP regressions, no installation or network required. */
define('ABSPATH', __DIR__);
$GLOBALS['sitemap_options'] = ['blog_public' => 1];
$GLOBALS['sitemap_posts'] = [];
$GLOBALS['sitemap_meta'] = [];
$GLOBALS['sitemap_hooks'] = [];
$GLOBALS['sitemap_base'] = 'https://example.test/site/';
function home_url(string $path = ''): string { return rtrim($GLOBALS['sitemap_base'], '/') . '/' . ltrim($path, '/'); }
function user_trailingslashit(string $path): string { return rtrim($path, '/') . '/'; }
function get_template_directory(): string { return $GLOBALS['sitemap_directory']; }
function get_option(string $name, mixed $fallback = false): mixed { return $GLOBALS['sitemap_options'][$name] ?? $fallback; }
function get_post_type_object(string $type): object { return (object) ['public' => $type !== 'internal']; }
function get_permalink(WP_Post $post): string { return home_url('articles/' . $post->post_name . '/'); }
function get_post_meta(int $id, string $key, bool $single = true): mixed { return $GLOBALS['sitemap_meta'][$id][$key] ?? ''; }
function get_post_type(int $id): string { return 'article'; }
function update_post_meta(int $id, string $key, mixed $value): void { $GLOBALS['sitemap_meta'][$id][$key] = $value; }
function apply_filters(string $name, mixed $value, mixed ...$args): mixed { return $value; }
function add_action(string $hook, mixed $callback, int $priority = 10, int $argc = 1): void { $GLOBALS['sitemap_hooks'][$hook][] = $callback; }
function add_filter(string $hook, mixed $callback, int $priority = 10, int $argc = 1): void { $GLOBALS['sitemap_hooks'][$hook][] = $callback; }
function status_header(int $status): void { $GLOBALS['sitemap_status'] = $status; }
function nocache_headers(): void {}
final class WP_Post {
    public int $ID;
    public string $post_type = 'article';
    public string $post_name;
    public string $post_status = 'publish';
    public string $post_password = '';
    public string $post_modified_gmt = '2026-09-01 12:00:00';
    public function __construct(int $id, string $slug) { $this->ID = $id; $this->post_name = $slug; }
}
final class WP_Query {
    public array $posts;
    public function __construct(array $args) {
        $matching = array_values(array_filter($GLOBALS['sitemap_posts'], static fn($post): bool => $post->post_type === $args['post_type'] && $post->post_status === 'publish' && $post->post_password === ''));
        $this->posts = array_slice($matching, ($args['paged'] - 1) * $args['posts_per_page'], $args['posts_per_page']);
    }
}
require dirname(__DIR__) . '/kodety/includes/class-kodety-sitemap.php';
if (($argv[1] ?? '') === 'serve') {
    $GLOBALS['sitemap_directory'] = $argv[2];
    $_SERVER['REQUEST_URI'] = $argv[3];
    $_SERVER['REQUEST_METHOD'] = $argv[4];
    if (($argv[5] ?? '') === 'private') $GLOBALS['sitemap_options']['blog_public'] = 0;
    register_shutdown_function(static function (): void { fwrite(STDERR, json_encode(['status' => $GLOBALS['sitemap_status'] ?? 0])); });
    Kodety_Sitemap::serve();
    exit;
}
function check(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function urls(array $contract, iterable $cms = []): array {
    $documents = Kodety_Sitemap::documents($contract, $cms);
    $result = [];
    foreach ($documents['files'] as $xml) {
        $document = new DOMDocument();
        check($document->loadXML($xml), 'XML deve ser bem formado');
        if ($document->documentElement->localName !== 'urlset') continue;
        foreach ($document->getElementsByTagName('loc') as $loc) $result[] = $loc->textContent;
    }
    sort($result);
    return $result;
}
function remove_fixture(string $path): void {
    if (!is_dir($path)) { @unlink($path); return; }
    foreach (new FilesystemIterator($path, FilesystemIterator::SKIP_DOTS) as $item) remove_fixture($item->getPathname());
    rmdir($path);
}
function request(string $directory, string $uri, string $method = 'GET', string $visibility = ''): array {
    $process = proc_open([PHP_BINARY, __FILE__, 'serve', $directory, $uri, $method, $visibility], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    $body = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]); fclose($pipes[2]);
    check(proc_close($process) === 0, 'Endpoint deve encerrar sem erro fatal: ' . $stderr);
    return ['body' => $body, 'status' => json_decode(substr($stderr, strrpos($stderr, '{') ?: 0), true)['status'] ?? -1];
}
$fixture = sys_get_temp_dir() . '/kodety-sitemap-' . bin2hex(random_bytes(6));
mkdir($fixture);
$source = $fixture . '/project';
$active = $fixture . '/active';
$staging = $fixture . '/staging';
mkdir($source); mkdir($active); mkdir($staging);
$GLOBALS['sitemap_directory'] = $active;
try {
    $pages = [
        'index.html' => '<html><head><title>Home</title></head><body>Home</body></html>',
        'about.html' => '<html><head></head><body>About</body></html>',
        'unlisted.html' => '<html><head></head><body>Unlisted</body></html>',
        'noindex.html' => '<html><head><meta content="follow, noindex" name="robots"></head><body></body></html>',
        'metadata-noindex.html' => '<html><head></head><body></body></html>',
        'canonical.html' => '<html><head><link rel="canonical" href="https://example.test/site/about/"></head></html>',
        'self.html' => '<html><head><link rel="canonical" href="https://example.test/site/self"></head></html>',
        'private.html' => '<html><head></head><body>Protected</body></html>',
        'old.html' => '<html><head></head><body>Redirected</body></html>',
        'draft.html' => '<html><head></head><body>Draft</body></html>',
        '404.html' => '<html><head></head><body>Not found</body></html>',
        'template.html' => '<html><head><link rel="canonical" href="{{permalink}}"></head><body>{{title}}</body></html>',
        'private-template.html' => '<html><head></head><body>Protected CMS</body></html>',
    ];
    $manifest = ['' => 'index.html', 'index' => 'index.html'];
    foreach ($pages as $path => $html) { file_put_contents($source . '/' . $path, $html); $manifest[substr($path, 0, -5)] = $path; }
    $metadata = [
        'pageSettings' => ['unlisted.html' => ['includeInSitemap' => false], 'metadata-noindex.html' => ['index' => false]],
        'pageStatuses' => ['draft.html' => 'draft'],
    ];
    $localization = [
        'sourceLocale' => 'en', 'defaultLocale' => 'en', 'translatePagePaths' => true,
        'locales' => [['code' => 'en', 'slug' => '', 'enabled' => true], ['code' => 'pt', 'slug' => 'pt', 'enabled' => true], ['code' => 'fr', 'slug' => 'fr', 'enabled' => false]],
        'translations' => ['pt' => ['pages' => ['about.html' => ['path' => 'sobre', 'title' => 'Sobre']]]],
    ];
    $membership = ['pages' => ['private.html' => ['pageRule' => []], 'private-template.html' => ['pageRule' => []]]];
    $redirects = ['entries' => [['source' => '/old', 'destination' => '/about', 'match' => 'exact'], ['source' => '/pt/old', 'destination' => '/pt/sobre', 'match' => 'exact']]];
    $build = static fn(string $release, array $previous = []): array => Kodety_Sitemap::build_contract($source, $manifest, $metadata, [], $localization, $membership, $redirects, ['article' => 'template.html', 'premium' => 'private-template.html'], $release, home_url('/'), $previous);
    $first = $build('release-one');
    check(urls($first) === ['https://example.test/site/', 'https://example.test/site/about/', 'https://example.test/site/pt/', 'https://example.test/site/pt/sobre/', 'https://example.test/site/self/'], 'Inventário deve respeitar manifest, idiomas, canonical, noindex, draft, acesso e exclusão');
    check(!isset($first['templates']['premium']), 'Política de template privado não deve expor rota ou URLs');
    check(!str_contains(json_encode($first), 'private.html'), 'Inventário não deve vazar nomes de páginas privadas');
    check(!str_contains(json_encode($first), 'private-template.html'), 'Inventário não deve vazar nomes de templates privados');

    foreach ($first['pages'] as &$entry) $entry['lastmod'] = '2025-01-01T00:00:00+00:00';
    unset($entry);
    $same = $build('release-two', $first);
    check(array_unique(array_column($same['pages'], 'lastmod')) === ['2025-01-01T00:00:00+00:00'], 'Republicação idêntica deve preservar lastmod significativo');
    file_put_contents($source . '/about.html', str_replace('About', 'About updated', $pages['about.html']));
    $changed = $build('release-three', $first);
    $lastmods = array_column($changed['pages'], 'lastmod', 'loc');
    check($lastmods['https://example.test/site/about/'] !== '2025-01-01T00:00:00+00:00', 'Edição de conteúdo deve atualizar lastmod');
    check($lastmods['https://example.test/site/'] === '2025-01-01T00:00:00+00:00', 'Edição de outra página não deve atualizar home');

    $visible = new WP_Post(1, 'first');
    $draft = new WP_Post(2, 'draft'); $draft->post_status = 'draft';
    $private = new WP_Post(3, 'private'); $private->post_status = 'private';
    $password = new WP_Post(4, 'password'); $password->post_password = 'protected';
    $noindex = new WP_Post(5, 'noindex'); $GLOBALS['sitemap_meta'][5]['rank_math_robots'] = ['noindex'];
    $alternate = new WP_Post(6, 'alternate'); $GLOBALS['sitemap_meta'][6]['_yoast_wpseo_canonical'] = home_url('articles/first/');
    $GLOBALS['sitemap_posts'] = [$visible, $draft, $private, $password, $noindex, $alternate];
    $cms = iterator_to_array(Kodety_Sitemap::cms_entries($first));
    check(array_column($cms, 'loc') === ['https://example.test/site/articles/first/'], 'CMS deve respeitar status, senha, SEO e canonical sem inventar variantes');
    check($cms[0]['lastmod'] === $first['templates']['article']['lastmod'], 'CMS inclui modificação significativa do template no lastmod');
    $old_template = $first;
    $old_template['templates']['article']['lastmod'] = '2025-01-01T00:00:00+00:00';
    check(iterator_to_array(Kodety_Sitemap::cms_entries($old_template))[0]['lastmod'] === '2026-09-01T12:00:00+00:00', 'Timestamp ausente de meta não pode virar a hora de cada fetch');
    $visible->post_status = 'draft';
    check(iterator_to_array(Kodety_Sitemap::cms_entries($first)) === [], 'Despublicar CMS deve retirar URL sem nova release');
    $visible->post_status = 'publish'; $visible->post_name = 'renamed';
    check(array_column(iterator_to_array(Kodety_Sitemap::cms_entries($first)), 'loc') === ['https://example.test/site/articles/renamed/'], 'Renomear CMS deve retirar slug anterior imediatamente');
    $GLOBALS['sitemap_posts'] = [];
    for ($id = 1; $id <= 1001; $id++) $GLOBALS['sitemap_posts'][] = new WP_Post($id, 'item-' . $id);
    $GLOBALS['sitemap_meta'] = [];
    check(count(iterator_to_array(Kodety_Sitemap::cms_entries($first))) === 1001, 'CMS deve percorrer todas as páginas da consulta');
    $GLOBALS['sitemap_posts'] = [];

    Kodety_Sitemap::prepare($active, $first);
    check(Kodety_Sitemap::read_contract($active)['release'] === 'release-one', 'Manifesto preparado deve preservar release');
    $guard = file_get_contents($active . '/sitemap-manifest.php');
    check(str_starts_with($guard, "<?php\ndefined('ABSPATH') || exit;"), 'Inventário interno não deve ser entregue como JSON público');
    Kodety_Sitemap::content_meta_changed(1, 1, '_edit_lock', 'lock');
    check(!isset($GLOBALS['sitemap_meta'][1]['_kodety_sitemap_modified_gmt']), 'Locks de edição não alteram lastmod');
    Kodety_Sitemap::content_meta_changed(1, 1, 'price', 99);
    check(isset($GLOBALS['sitemap_meta'][1]['_kodety_sitemap_modified_gmt']), 'Campo CMS alterado deve atualizar timestamp de conteúdo');
    check(request($active, '/site/sitemap.xml')['status'] === 200, 'Endpoint público deve responder HTTP 200');
    check(str_contains(request($active, '/site/sitemap.xml')['body'], '<urlset'), 'Endpoint público deve entregar XML');
    $head = request($active, '/site/sitemap.xml', 'HEAD');
    check($head['status'] === 200 && $head['body'] === '', 'HEAD preserva status sem corpo');
    check(request($active, '/site/sitemap.xml', 'POST')['status'] === 405, 'Método não suportado deve responder 405');
    check(request($active, '/site/kodety-sitemap-99.xml')['status'] === 404, 'Parte inexistente deve responder 404');
    check(request($active, '/site/sitemap.xml', 'GET', 'private')['status'] === 404, 'Site privado não expõe sitemap');
    check(Kodety_Sitemap::request_document('/site-other/sitemap.xml', home_url('/')) === '', 'Base path deve ser limitado por segmento');
    check(Kodety_Sitemap::request_document('/site/kodety/preview/token/sitemap.xml', home_url('/')) === '', 'Rota de preview não pode executar sitemap público');

    $before = file_get_contents($active . '/sitemap.xml');
    // Throw after XML generation begins, as a CMS/storage failure would during
    // preparation. Only staging may be touched; the active release is intact.
    $failing = static function (): Generator { yield ['loc' => home_url('new/')]; throw new RuntimeException('injected CMS failure'); };
    try { Kodety_Sitemap::prepare($staging, $changed, $failing()); throw new LogicException('Falha injetada não propagou'); }
    catch (RuntimeException $error) { check($error->getMessage() === 'injected CMS failure', 'Falha deve manter causa'); }
    check(file_get_contents($active . '/sitemap.xml') === $before, 'Falha de preparação preserva sitemap ativo');
    check(!is_file($staging . '/sitemap-manifest.php'), 'Falha não pode gravar ponteiro de inventário');
    Kodety_Sitemap::prepare($staging, $changed);
    rename($active, $fixture . '/backup'); rename($staging, $active);
    check(Kodety_Sitemap::read_contract($active)['release'] === 'release-three', 'Ativação troca XML e inventário juntos');
    rename($active, $staging); rename($fixture . '/backup', $active);
    check(file_get_contents($active . '/sitemap.xml') === $before && Kodety_Sitemap::read_contract($active)['release'] === 'release-one', 'Rollback restaura inventário e XML anteriores juntos');

    $large = $first; $large['pages'] = [];
    for ($index = 0; $index < 50001; $index++) $large['pages'][] = ['loc' => home_url('page-' . $index . '/')];
    $split = Kodety_Sitemap::documents($large);
    check($split['urlCount'] === 50001 && count($split['files']) === 3, '50.001 URLs devem produzir duas partes e um índice');
    check(substr_count($split['files']['kodety-sitemap-1.xml'], '<url>') === 50000, 'Parte deve respeitar teto real 50.000');
    check(substr_count($split['files']['kodety-sitemap-2.xml'], '<url>') === 1, 'Última URL deve sobreviver à divisão');
    $small = Kodety_Sitemap::documents($first, [], 50000, 320);
    check(count($small['files']) > 1, 'Divisão deve respeitar bytes além de quantidade');
    foreach ($small['files'] as $name => $xml) if ($name !== 'sitemap.xml') check(strlen($xml) <= 320, 'Parte não pode ultrapassar orçamento de bytes');
    $escaped = $first; $escaped['pages'] = [['loc' => home_url('ação/') . '?x=1&y=2']];
    $encoded = Kodety_Sitemap::documents($escaped)['files']['sitemap.xml'];
    check(str_contains($encoded, 'a%C3%A7%C3%A3o/') && str_contains($encoded, '?x=1&amp;y=2'), 'Unicode e entidades devem ser codificados corretamente');
    check(Kodety_Sitemap::route_url('folder/my page', home_url('/')) === 'https://example.test/site/folder/my%20page/', 'Espaços em nomes de arquivos devem virar percent-encoding');
    check(Kodety_Sitemap::absolute_url('https://evil.test/page/', home_url('/')) === '', 'Host externo não deve entrar no sitemap');
    check(Kodety_Sitemap::absolute_url('https://example.test/site/%2e%2e/admin', home_url('/')) === '', 'Traversal codificado não deve ser publicado');
    $static = $first; $static['templates'] = [];
    Kodety_Sitemap::prepare($staging, $static);
    check(request($staging, '/site/sitemap.xml')['body'] === file_get_contents($staging . '/sitemap.xml'), 'Fast path deve servir os bytes validados no staging');
    file_put_contents($staging . '/sitemap.xml', '<html>damaged</html>');
    check(request($staging, '/site/sitemap.xml')['status'] === 503, 'Artefato corrompido não pode ser entregue como XML válido');
    $disabled = $first; $disabled['enabled'] = false;
    check(Kodety_Sitemap::documents($disabled)['urlCount'] === 0, 'sitemapEnabled=false deve suspender inventário');
    Kodety_Sitemap::prepare($staging, $disabled);
    check(request($staging, '/site/sitemap.xml')['status'] === 404, 'Sitemap desativado não cai no redirect nativo');

    $robots = "User-agent: *\nSitemap: https://example.test/site/wp-sitemap.xml\nSitemap: https://example.test/site/wp-sitemap.xml\nSitemap: https://example.test/site/sitemap.xml\n";
    $robots = Kodety_Sitemap::robots($robots, true);
    check(substr_count($robots, 'wp-sitemap.xml') === 1 && substr_count($robots, '/site/sitemap.xml') === 1, 'Robots deve deduplicar e preservar sitemap WordPress legítimo');
    check(!str_contains(Kodety_Sitemap::robots($robots, false), '/site/sitemap.xml'), 'Robots privado não deve descobrir sitemap Kodety');
    $query = Kodety_Sitemap::wordpress_query(['meta_query' => ['relation' => 'OR', ['key' => 'a'], ['key' => 'b']]], 'page');
    check($query['meta_query']['relation'] === 'AND' && count($query['meta_query']) === 3, 'Deduplicação de páginas não pode enfraquecer filtros de consulta existentes');
    check(Kodety_Sitemap::wordpress_query([], 'article')['post__in'] === [0], 'WordPress não deve duplicar itens de templates Kodety');
    check(Kodety_Sitemap::wordpress_query([], 'premium')['post__in'] === [0], 'Templates privados não devem vazar via sitemap WordPress');
    check(Kodety_Sitemap::wordpress_query(['test' => 1], 'post') === ['test' => 1], 'Sitemap de conteúdo WordPress legítimo deve ser preservado');
    $diagnostic = Kodety_Sitemap::diagnostics();
    check($diagnostic['generated'] && $diagnostic['release'] === 'release-one' && $diagnostic['urlCount'] === 5, 'Diagnóstico deve refletir inventário e release ativos');
    check($diagnostic['accessStatus'] === 'unverified' && $diagnostic['googleProcessingStatus'] === 'unverified', 'Geração local não pode afirmar acesso ou processamento Google');
    Kodety_Sitemap::register();
    check(isset($GLOBALS['sitemap_hooks']['parse_request']), 'Dono da rota deve executar antes de redirects WordPress');
    $discovery = $GLOBALS['sitemap_hooks']['kodety_search_console_sitemap_urls'][0];
    check($discovery([home_url('wp-sitemap.xml'), home_url('sitemap.xml')], home_url('/')) === [home_url('sitemap.xml'), home_url('wp-sitemap.xml')], 'Search Console deve descobrir o sitemap Kodety primeiro sem duplicação');
    // Introduce the real runtime option bridge only for live-assignment cases.
    if (!function_exists('kodety_project_cms_option')) {
        function kodety_project_cms_option(string $key, mixed $default = []): mixed { return $GLOBALS['sitemap_live_mappings'] ?? []; }
    }
    $GLOBALS['sitemap_posts'] = [new WP_Post(1, 'first')];
    $GLOBALS['sitemap_live_mappings'] = ['article' => 'template.html'];
    check(count(iterator_to_array(Kodety_Sitemap::cms_entries($first))) === 1, 'Assignment público deve usar política da página publicada');
    $GLOBALS['sitemap_live_mappings'] = ['article' => 'private-template.html'];
    check(iterator_to_array(Kodety_Sitemap::cms_entries($first)) === [], 'Trocar assignment CMS para template privado deve retirar URLs imediatamente');
    $GLOBALS['sitemap_live_mappings'] = ['article' => 'noindex.html'];
    check(iterator_to_array(Kodety_Sitemap::cms_entries($first)) === [], 'Trocar assignment CMS para noindex não pode reutilizar política antiga');
    $GLOBALS['sitemap_live_mappings'] = ['article' => 'not-published.html'];
    check(iterator_to_array(Kodety_Sitemap::cms_entries($first)) === [], 'Novo template não publicado não pode expor itens');
    $GLOBALS['sitemap_live_mappings'] = [];
    check(iterator_to_array(Kodety_Sitemap::cms_entries($first)) === [], 'Remover assignment CMS deve remover inventário antigo');
    echo "sitemap-runtime: elegibilidade, CMS, idiomas, XML/50k/bytes, HTTP, atomicidade, rollback, robots e diagnóstico aprovados.\n";
} finally {
    remove_fixture($fixture);
}
