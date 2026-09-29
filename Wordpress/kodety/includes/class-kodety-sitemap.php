<?php

defined('ABSPATH') || exit;

/** A release-owned inventory; WordPress content is projected only through its
 * published templates. No workspace, preview URL or crawler credentials enter
 * this contract. XML is prepared before the theme's atomic activation. */
final class Kodety_Sitemap {
    public const MAX_URLS = 50000;
    public const MAX_BYTES = 52428800;
    private const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
    private const NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';

    public static function register(): void {
        // parse_request precedes core's sitemap redirect and SEO-plugin output.
        add_action('parse_request', [self::class, 'serve'], -1000);
        add_filter('robots_txt', [self::class, 'robots'], PHP_INT_MAX, 2);
        add_filter('wp_sitemaps_posts_query_args', [self::class, 'wordpress_query'], 100, 2);
        foreach (['added_post_meta', 'updated_post_meta', 'deleted_post_meta'] as $hook) {
            add_action($hook, [self::class, 'content_meta_changed'], 100, 4);
        }
        add_filter('kodety_search_console_sitemap_urls', static function (array $urls, string $site): array {
            return array_values(array_unique(array_merge([rtrim($site, '/') . '/sitemap.xml'], $urls)));
        }, 10, 2);
    }

    public static function read_contract(string $directory): array {
        $path = rtrim($directory, '/\\') . '/sitemap-manifest.php';
        if (!is_file($path) || is_link($path)) return [];
        clearstatcache(true, $path);
        $stat = stat($path);
        $size = is_array($stat) ? $stat['size'] : false;
        if (!is_int($size) || $size < 2 || $size > 64 * 1024 * 1024) {
            throw new RuntimeException('O inventário do sitemap excede o limite seguro.');
        }
        static $cache = [];
        $signature = implode(':', [$stat['dev'], $stat['ino'], $stat['size'], $stat['mtime']]);
        if (($cache[$path]['signature'] ?? '') === $signature) return $cache[$path]['contract'];
        $payload = (string) file_get_contents($path);
        $prefix = "<?php\ndefined('ABSPATH') || exit;\nreturn json_decode(base64_decode('";
        $suffix = "'), true);\n";
        if (!str_starts_with($payload, $prefix) || !str_ends_with($payload, $suffix)) {
            throw new RuntimeException('O inventário privado do sitemap é inválido.');
        }
        $decoded = base64_decode(substr($payload, strlen($prefix), -strlen($suffix)), true);
        $contract = is_string($decoded) ? json_decode($decoded, true) : null;
        if (!is_array($contract) || ($contract['version'] ?? 0) !== 1
            || !is_array($contract['pages'] ?? null) || !is_array($contract['templates'] ?? null)) {
            throw new RuntimeException('O inventário do sitemap publicado é inválido.');
        }
        $cache[$path] = ['signature' => $signature, 'contract' => $contract];
        return $contract;
    }

    private static function directory(): string {
        return function_exists('kodety_runtime_directory')
            ? kodety_runtime_directory() : get_template_directory();
    }

    /** Preserve the host/base path, percent-encode Unicode, reject credentials,
     * fragments, unsafe paths and unresolved CMS bindings. */
    public static function absolute_url(string $url, string $base): string {
        $url = trim(html_entity_decode($url, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($url === '' || !preg_match('//u', $url) || preg_match('/[\x00-\x20\x7f{}<>"\\\\]/u', $url)) return '';
        $home = parse_url($base);
        if (!is_array($home) || empty($home['host']) || !in_array($home['scheme'] ?? '', ['http', 'https'], true)) return '';
        $origin = strtolower($home['scheme']) . '://' . strtolower($home['host']) . (isset($home['port']) ? ':' . $home['port'] : '');
        if (str_starts_with($url, '//')) $url = $home['scheme'] . ':' . $url;
        elseif (str_starts_with($url, '/')) $url = $origin . $url;
        elseif (!preg_match('~^[a-z][a-z0-9+.-]*:~i', $url)) $url = rtrim($base, '/') . '/' . $url;
        $parts = parse_url($url);
        if (!is_array($parts) || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment'])
            || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
            || strtolower((string) ($parts['host'] ?? '')) !== strtolower($home['host'])
            || strtolower((string) ($parts['scheme'] ?? '')) !== strtolower($home['scheme'])
            || (int) ($parts['port'] ?? 0) !== (int) ($home['port'] ?? 0)) return '';
        $segments = [];
        foreach (explode('/', (string) ($parts['path'] ?? '/')) as $segment) {
            $decoded = rawurldecode($segment);
            if ($decoded === '.' || $decoded === '..' || preg_match('/[\x00-\x1f\x7f\/\\\\]/', $decoded)) return '';
            $segments[] = rawurlencode($decoded);
        }
        $path = implode('/', $segments);
        $home_path = rtrim((string) ($home['path'] ?? ''), '/');
        if ($home_path !== '' && $path !== $home_path && !str_starts_with($path, $home_path . '/')) return '';
        $normalized = $origin . ($path !== '' ? $path : '/') . (isset($parts['query']) ? '?' . $parts['query'] : '');
        return strlen($normalized) < 2048 ? $normalized : '';
    }

    public static function route_url(string $route, string $base): string {
        $route = trim($route, '/');
        $route = implode('/', array_map(static fn(string $segment): string => rawurlencode(rawurldecode($segment)), explode('/', $route)));
        $path = $route === '' ? '' : (function_exists('user_trailingslashit') ? user_trailingslashit($route) : $route . '/');
        return self::absolute_url(rtrim($base, '/') . '/' . $path, $base);
    }

    private static function same_url(string $left, string $right): bool {
        // Trailing slash policy is applied by route_url(), not guessed here.
        return $left !== '' && rtrim($left, '/') === rtrim($right, '/');
    }

    public static function canonical_routes(array $manifest): array {
        $routes = [];
        $main = (string) ($manifest[''] ?? '');
        $web_root = trim(str_replace('\\', '/', dirname($main)), './');
        foreach ($manifest as $route => $file) {
            if (!is_string($file) || !is_string($route)) continue;
            $file = trim(str_replace('\\', '/', $file), '/');
            $route = trim(rawurldecode(str_replace('\\', '/', $route)), '/');
            if ($file === '' || preg_match('~(?:^|/)\.\.?(/|$)~', $file . '/' . $route)) continue;
            if ($web_root !== '' && stripos($route . '/', $web_root . '/') === 0) $route = ltrim(substr($route, strlen($web_root)), '/');
            $key = strtolower($file);
            if (!isset($routes[$key]) || ($routes[$key]['route'] !== '' && ($route === '' || strlen($route) < strlen($routes[$key]['route'])))) {
                $routes[$key] = ['path' => $file, 'route' => $route];
            }
        }
        return array_values($routes);
    }

    /** Parse actual markup, so authored noindex is respected even without
     * metadata. DOM does not load external resources (LIBXML_NONET). */
    public static function html_policy(string $html): array {
        if (!class_exists('DOMDocument')) throw new RuntimeException('A geração do sitemap requer a extensão PHP DOM.');
        $document = new DOMDocument('1.0', 'UTF-8');
        $before = libxml_use_internal_errors(true);
        try {
            if (!$document->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) {
                throw new RuntimeException('Uma página não pôde ser analisada para gerar o sitemap.');
            }
            $index = true;
            $canonicals = [];
            foreach ($document->getElementsByTagName('meta') as $meta) {
                $name = strtolower(trim($meta->getAttribute('name')));
                if (!in_array($name, ['robots', 'googlebot', 'bingbot'], true)) continue;
                if (preg_match('/(?:^|[\s,])(?:noindex|none)(?:[\s,]|$)/i', $meta->getAttribute('content'))) $index = false;
            }
            foreach ($document->getElementsByTagName('link') as $link) {
                if (preg_match('/(?:^|\s)canonical(?:\s|$)/i', $link->getAttribute('rel'))) $canonicals[] = trim($link->getAttribute('href'));
            }
            return ['index' => $index, 'canonicals' => array_values(array_unique($canonicals))];
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($before);
        }
    }

    public static function redirected(string $route, array $redirects): bool {
        $route = '/' . trim(rawurldecode($route), '/');
        foreach ((array) ($redirects['entries'] ?? []) as $entry) {
            if (!is_array($entry) || ($entry['enabled'] ?? true) === false) continue;
            $source = '/' . trim(rawurldecode((string) ($entry['source'] ?? '')), '/');
            $kind = (string) ($entry['match'] ?? 'exact');
            if ($kind === 'exact' && strcasecmp($source, $route) === 0) return true;
            if ($kind === 'prefix' && ($source === '/' || strcasecmp($source, $route) === 0 || str_starts_with(strtolower($route), strtolower($source) . '/'))) return true;
            if ($kind === 'wildcard' && preg_match('~^' . str_replace('\\*', '.*', preg_quote($source, '~')) . '$~iu', $route)) return true;
        }
        return false;
    }

    private static function locale_routes(string $path, string $route, array $localization): array {
        $source = (string) ($localization['sourceLocale'] ?? '');
        $default = (string) ($localization['defaultLocale'] ?? $source);
        $routes = [];
        foreach ((array) ($localization['locales'] ?? []) as $locale) {
            if (!is_array($locale) || empty($locale['code']) || ($locale['enabled'] ?? true) === false) continue;
            $code = (string) $locale['code'];
            $localized = $route;
            if (!empty($localization['translatePagePaths']) && $code !== $source) {
                $translated = trim((string) ($localization['translations'][$code]['pages'][$path]['path'] ?? ''), '/');
                if ($translated !== '') $localized = $translated;
            }
            $prefix = $code === $default ? '' : trim((string) ($locale['slug'] ?? ''), '/');
            $routes[] = [
                'route' => trim(($prefix !== '' ? $prefix . '/' : '') . $localized, '/'),
                'locale' => $code,
                'translation' => $localization['translations'][$code]['pages'][$path] ?? [],
            ];
        }
        return $routes ?: [['route' => $route, 'locale' => '', 'translation' => []]];
    }

    public static function build_contract(
        string $root, array $manifest, array $metadata, array $seo, array $localization,
        array $membership, array $redirects, array $templates, string $release, string $base,
        array $previous = []
    ): array {
        $now = gmdate('c');
        $pages = [];
        $policies = [];
        $site = is_array($metadata['siteSettings'] ?? null) ? $metadata['siteSettings'] : [];
        $previous_pages = [];
        foreach ((array) ($previous['pages'] ?? []) as $entry) $previous_pages[(string) ($entry['loc'] ?? '')] = $entry;
        $template_paths = array_map(static fn($path): string => strtolower(trim((string) $path, '/')), array_values($templates));
        foreach (self::canonical_routes($manifest) as $definition) {
            $path = $definition['path'];
            $route = $definition['route'];
            // 404 and internal experiment routes are never search destinations.
            if (preg_match('~(?:^|/)(?:404(?:\.html?)?|\.incode|\.coday|\.kodety[^/]*|kodety|wp-admin|wp-login\.php)(?:/|$)~i', $route . '/' . $path)) continue;
            $settings = is_array($metadata['pageSettings'][$path] ?? null) ? $metadata['pageSettings'][$path] : [];
            $full = realpath($root . '/' . $path);
            $real_root = realpath($root);
            if (!$full || !$real_root || !str_starts_with($full, rtrim($real_root, '/') . '/') || !is_file($full)) {
                throw new RuntimeException('O sitemap encontrou uma página ausente na publicação.');
            }
            $html = file_get_contents($full);
            if (!is_string($html)) throw new RuntimeException('Uma página não pôde ser lida para gerar o sitemap.');
            $policy = self::html_policy($html);
            $policy['index'] = $policy['index'] && ($settings['index'] ?? $site['defaultIndex'] ?? true) !== false;
            $policy['eligible'] = $policy['index']
                && ($settings['includeInSitemap'] ?? true) !== false
                && ($metadata['pageStatuses'][$path] ?? 'published') !== 'draft'
                && !in_array($path, (array) ($seo['excludedPaths'] ?? []), true)
                && !isset($membership['pages'][$path]['pageRule']);
            $policy['route'] = $route;
            $policy['path'] = $path;
            $policy['digest'] = hash('sha256', $html);
            $policy['lastmod'] = $now;
            foreach (array_merge((array) ($previous['pagePolicies'] ?? []), (array) ($previous['templates'] ?? [])) as $old_policy) {
                if (($old_policy['path'] ?? '') === $path && ($old_policy['digest'] ?? '') === $policy['digest']) {
                    $policy['lastmod'] = $old_policy['lastmod'] ?? $now;
                    break;
                }
            }
            $policies[$path] = $policy;
            if (!$policy['eligible'] || in_array(strtolower($path), $template_paths, true)) continue;
            foreach (self::locale_routes($path, $route, $localization) as $localized) {
                $url = self::route_url($localized['route'], $base);
                if ($url === '' || self::redirected($localized['route'], $redirects)) continue;
                // Canonicals are authoritative. A locale pointing to the source
                // page is not an independently indexable URL.
                foreach ($policy['canonicals'] as $canonical) {
                    if (!self::same_url(self::absolute_url($canonical, $base), $url)) continue 2;
                }
                $digest = hash('sha256', $policy['digest'] . json_encode($localized['translation'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
                $old = $previous_pages[$url] ?? [];
                $pages[$url] = [
                    'loc' => $url,
                    'lastmod' => ($old['digest'] ?? '') === $digest ? ($old['lastmod'] ?? $now) : $now,
                    'digest' => $digest,
                ];
            }
        }
        $published_templates = [];
        foreach ($templates as $type => $path) {
            if (!empty($policies[$path]['eligible'])) $published_templates[$type] = $policies[$path];
        }
        return [
            'version' => 1, 'source' => 'kodety-publication', 'release' => $release,
            'enabled' => ($site['sitemapEnabled'] ?? $seo['sitemapEnabled'] ?? true) !== false,
            'baseUrl' => rtrim($base, '/') . '/', 'generatedAt' => $now,
            'pages' => array_values($pages), 'templates' => $published_templates,
            'managedPostTypes' => array_keys($templates),
            'pagePolicies' => array_filter($policies, static fn(array $policy): bool => !empty($policy['eligible'])),
            'redirects' => $redirects,
            // CMS locale routes are emitted only when their canonical points
            // to that exact route; no translated item slug is invented.
            'locales' => array_values(array_filter((array) ($localization['locales'] ?? []), static fn($locale): bool => is_array($locale) && ($locale['enabled'] ?? true) !== false)),
            'defaultLocale' => (string) ($localization['defaultLocale'] ?? $localization['sourceLocale'] ?? ''),
        ];
    }

    private static function live_template_mappings(array $contract): ?array {
        if (!function_exists('kodety_project_cms_option')) return null;
        $mappings = kodety_project_cms_option('kodety_cms_templates', []);
        return is_array($mappings) ? $mappings : [];
    }

    /** Template assignments can be edited in CMS without a Builder release.
     * Resolve that live mapping against policies of published files only; a
     * new private/noindex/missing template cannot inherit an old public policy. */
    private static function current_templates(array $contract): array {
        $mappings = self::live_template_mappings($contract);
        if ($mappings === null) return $contract['templates'];
        $templates = [];
        foreach ($mappings as $type => $path) {
            if (!is_string($type) || !is_string($path)) continue;
            $policy = $contract['pagePolicies'][$path] ?? null;
            if (is_array($policy) && !empty($policy['eligible'])) $templates[$type] = $policy;
        }
        return $templates;
    }

    /** Live post status is intentional: unpublishing an item must remove it
     * immediately without requiring a new Builder release. Batched queries
     * bound database work without silently truncating large collections. */
    public static function cms_entries(array $contract): Generator {
        $base = (string) $contract['baseUrl'];
        foreach (self::current_templates($contract) as $type => $policy) {
            if (empty($policy['eligible']) || in_array($type, ['attachment', 'page'], true)) continue;
            $object = get_post_type_object($type);
            if (!$object || empty($object->public) || (isset($object->publicly_queryable) && !$object->publicly_queryable)) continue;
            $page = 1;
            do {
                $query = new WP_Query([
                    'post_type' => $type, 'post_status' => 'publish', 'has_password' => false,
                    'posts_per_page' => 500, 'paged' => $page, 'orderby' => 'ID', 'order' => 'ASC',
                    'no_found_rows' => true, 'ignore_sticky_posts' => true,
                    'update_post_term_cache' => false, 'cache_results' => false,
                ]);
                $posts = $query->posts;
                foreach ($posts as $post) {
                    if (!$post instanceof WP_Post || $post->post_status !== 'publish' || $post->post_password !== '') continue;
                    if (!(bool) apply_filters('kodety_sitemap_post_is_public', true, $post, $policy)) continue;
                    if (in_array((string) get_post_meta($post->ID, '_yoast_wpseo_meta-robots-noindex', true), ['1'], true)
                        || in_array('noindex', (array) get_post_meta($post->ID, 'rank_math_robots', true), true)) continue;
                    $permalink = self::absolute_url((string) get_permalink($post), $base);
                    if ($permalink === '') continue;
                    $route = ltrim(substr($permalink, strlen(rtrim($base, '/'))), '/');
                    $variants = [$route];
                    foreach ((array) ($contract['locales'] ?? []) as $locale) {
                        if (($locale['code'] ?? '') === ($contract['defaultLocale'] ?? '') || empty($locale['slug'])) continue;
                        $variants[] = trim((string) $locale['slug'], '/') . '/' . $route;
                    }
                    foreach (array_unique($variants) as $variant) {
                        $url = self::route_url($variant, $base);
                        if ($url === '' || self::redirected($variant, (array) $contract['redirects'])) continue;
                        $canonicals = (array) ($policy['canonicals'] ?? []);
                        foreach (['_yoast_wpseo_canonical', 'rank_math_canonical_url'] as $meta) {
                            $canonical = (string) get_post_meta($post->ID, $meta, true);
                            if ($canonical !== '') $canonicals[] = $canonical;
                        }
                        foreach ($canonicals as $canonical) {
                            $resolved = str_replace(['{{permalink}}', '{{slug}}'], [$permalink, $post->post_name], $canonical);
                            if (!self::same_url(self::absolute_url($resolved, $base), $url)) continue 2;
                        }
                        $entry = ['loc' => $url];
                        $template_time = strtotime((string) ($policy['lastmod'] ?? ''));
                        $meta_modified = trim((string) get_post_meta($post->ID, '_kodety_sitemap_modified_gmt', true));
                        $meta_time = $meta_modified !== '' ? strtotime($meta_modified . ' UTC') : false;
                        $lastmod_time = max($template_time ?: 0, $meta_time ?: 0);
                        $modified = trim((string) ($post->post_modified_gmt ?? ''));
                        if ($modified !== '' && $modified !== '0000-00-00 00:00:00') {
                            $time = strtotime($modified . ' UTC');
                            if ($time !== false && $time <= time()) $lastmod_time = max($lastmod_time, $time);
                        }
                        if ($lastmod_time > 0 && $lastmod_time <= time()) $entry['lastmod'] = gmdate('c', $lastmod_time);
                        yield $entry;
                    }
                }
                $page++;
            } while (count($posts) === 500);
        }
    }

    public static function documents(array $contract, iterable $cms = [], int $max_urls = self::MAX_URLS, int $max_bytes = self::MAX_BYTES): array {
        if ($max_urls < 1 || $max_urls > self::MAX_URLS || $max_bytes > self::MAX_BYTES) throw new InvalidArgumentException('Limites de sitemap inválidos.');
        $open = self::XML_HEADER . '<urlset xmlns="' . self::NAMESPACE . '">' . "\n";
        $close = "</urlset>\n";
        $xml = $open;
        $seen = [];
        $chunks = [];
        $count = 0;
        $total = 0;
        $entries = static function () use ($contract, $cms): Generator {
            if (empty($contract['enabled'])) return;
            yield from $contract['pages'];
            yield from $cms;
        };
        foreach ($entries() as $entry) {
            $url = self::absolute_url((string) ($entry['loc'] ?? ''), (string) $contract['baseUrl']);
            if ($url === '' || isset($seen[$url])) continue;
            $seen[$url] = true;
            $item = '<url><loc>' . self::escape($url) . '</loc>';
            $modified = (string) ($entry['lastmod'] ?? '');
            if ($modified !== '' && preg_match('/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2}))?$/D', $modified)) $item .= '<lastmod>' . self::escape($modified) . '</lastmod>';
            $item .= "</url>\n";
            if (strlen($open . $item . $close) > $max_bytes) throw new RuntimeException('Uma URL excede o limite XML do sitemap.');
            if ($count >= $max_urls || strlen($xml) + strlen($item) + strlen($close) > $max_bytes) {
                $chunks[] = $xml . $close;
                $xml = $open;
                $count = 0;
            }
            $xml .= $item;
            $count++;
            $total++;
        }
        $chunks[] = $xml . $close;
        if (count($chunks) > self::MAX_URLS) throw new RuntimeException('O índice do sitemap excede 50.000 documentos.');
        $files = [];
        if (count($chunks) === 1) $files['sitemap.xml'] = $chunks[0];
        else {
            $index = self::XML_HEADER . '<sitemapindex xmlns="' . self::NAMESPACE . '">' . "\n";
            foreach ($chunks as $number => $chunk) {
                $name = 'kodety-sitemap-' . ($number + 1) . '.xml';
                $files[$name] = $chunk;
                $index .= '<sitemap><loc>' . self::escape(rtrim((string) $contract['baseUrl'], '/') . '/' . $name) . "</loc></sitemap>\n";
            }
            $files['sitemap.xml'] = $index . "</sitemapindex>\n";
        }
        foreach ($files as $xml) {
            if (strlen($xml) > self::MAX_BYTES) throw new RuntimeException('O sitemap excede 50 MB.');
            self::validate_xml($xml);
        }
        return ['files' => $files, 'urlCount' => $total];
    }

    private static function escape(string $value): string {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }

    public static function validate_xml(string $xml): void {
        if (!class_exists('DOMDocument')) throw new RuntimeException('A validação do sitemap requer a extensão PHP DOM.');
        $document = new DOMDocument();
        $before = libxml_use_internal_errors(true);
        try {
            if (!$document->loadXML($xml, LIBXML_NONET) || $document->documentElement?->namespaceURI !== self::NAMESPACE) {
                throw new RuntimeException('O XML gerado para o sitemap é inválido.');
            }
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($before);
        }
    }

    private static function write(string $path, string $content): void {
        $temporary = $path . '.tmp-' . bin2hex(random_bytes(6));
        try {
            if (file_put_contents($temporary, $content, LOCK_EX) !== strlen($content)
                || !hash_equals(hash('sha256', $content), (string) hash_file('sha256', $temporary))
                || !rename($temporary, $path)) throw new RuntimeException('O sitemap não pôde ser gravado integralmente na nova versão.');
        } finally {
            if (is_file($temporary)) @unlink($temporary);
        }
    }

    public static function prepare(string $directory, array $contract, iterable $cms = []): void {
        $result = self::documents($contract, $cms);
        $contract['urlCount'] = $result['urlCount'];
        $contract['documentHashes'] = [];
        foreach ($result['files'] as $name => $xml) {
            self::write($directory . '/' . $name, $xml);
            $contract['documentHashes'][$name] = hash('sha256', $xml);
        }
        $json = json_encode($contract, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if (strlen($json) > 64 * 1024 * 1024) throw new RuntimeException('O inventário do sitemap excede 64 MB.');
        // The pointer is the final write. The caller swaps this entire staged
        // theme together with manifest.json, so failed publication/rollback
        // never advertises routes belonging to another release.
        $guarded = "<?php\ndefined('ABSPATH') || exit;\nreturn json_decode(base64_decode('"
            . base64_encode($json) . "'), true);\n";
        if (strlen($guarded) > 64 * 1024 * 1024) throw new RuntimeException('O inventário privado do sitemap excede 64 MB.');
        self::write($directory . '/sitemap-manifest.php', $guarded);
    }

    public static function request_document(string $request, string $base): string {
        $path = (string) parse_url($request, PHP_URL_PATH);
        $prefix = rtrim((string) parse_url($base, PHP_URL_PATH), '/');
        if ($prefix !== '' && !str_starts_with($path, $prefix . '/')) return '';
        $path = ltrim(substr($path, strlen($prefix)), '/');
        return preg_match('/^(?:sitemap|kodety-sitemap-[1-9][0-9]{0,4})\.xml$/D', $path) ? $path : '';
    }

    public static function serve(): void {
        $name = self::request_document((string) ($_SERVER['REQUEST_URI'] ?? ''), home_url('/'));
        if ($name === '') return;
        try {
            $contract = self::read_contract(self::directory());
            if (!$contract) return; // Existing non-Kodety/legacy ownership survives.
            if (empty($contract['enabled']) || !(bool) get_option('blog_public', 1)) {
                status_header(404);
                nocache_headers();
                exit;
            }
            $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
            if (!in_array($method, ['GET', 'HEAD'], true)) {
                status_header(405);
                header('Allow: GET, HEAD');
                exit;
            }
            $xml = null;
            if (empty($contract['templates']) && empty(self::current_templates($contract))) {
                // Static releases already validated these exact bytes before
                // activation. Avoid rebuilding/parsing every URL per fetch.
                $hash = (string) ($contract['documentHashes'][$name] ?? '');
                if ($hash !== '') {
                    $path = self::directory() . '/' . $name;
                    $xml = is_file($path) && !is_link($path) ? file_get_contents($path) : false;
                    if (!is_string($xml) || !hash_equals($hash, hash('sha256', $xml))) {
                        throw new RuntimeException('O arquivo do sitemap não corresponde à release publicada.');
                    }
                }
            } else {
                $result = self::documents($contract, self::cms_entries($contract));
                $xml = $result['files'][$name] ?? null;
            }
            if (!is_string($xml)) { status_header(404); nocache_headers(); exit; }
            while (ob_get_level() > 0) ob_end_clean();
            status_header(200);
            header('Content-Type: application/xml; charset=UTF-8');
            header('X-Content-Type-Options: nosniff');
            // Revalidation keeps CMS status changes visible without cache purge.
            header('Cache-Control: public, no-cache, must-revalidate');
            header('ETag: "' . hash('sha256', $xml) . '"');
            header('Content-Length: ' . strlen($xml));
            if ($method !== 'HEAD') echo $xml; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- validated XML.
            exit;
        } catch (Throwable $error) {
            error_log('[Onun Kodety sitemap] ' . $error->getMessage());
            status_header(503);
            nocache_headers();
            header('Retry-After: 60');
            exit;
        }
    }

    /** Native custom-field edits can change rendered CMS content without
     * touching post_modified_gmt. Keep a content timestamp, ignoring editor
     * locks and this timestamp itself to avoid recursive metadata writes. */
    public static function content_meta_changed(mixed $meta_id, int $post_id, string $key, mixed $value): void {
        if (in_array($key, ['_kodety_sitemap_modified_gmt', '_edit_lock', '_edit_last'], true)) return;
        try { $contract = self::read_contract(self::directory()); }
        catch (Throwable $error) { return; }
        if (!$contract) return;
        $type = get_post_type($post_id);
        if (!is_string($type) || empty(self::current_templates($contract)[$type]['eligible'])) return;
        update_post_meta($post_id, '_kodety_sitemap_modified_gmt', gmdate('Y-m-d H:i:s'));
    }

    public static function diagnostics(): array {
        $base = home_url('/');
        $result = [
            'generated' => false, 'enabled' => false, 'url' => rtrim($base, '/') . '/sitemap.xml',
            'source' => 'kodety-publication', 'release' => '', 'urlCount' => 0, 'generatedAt' => '',
            'validationErrors' => [], 'accessStatus' => 'unverified',
            'googleSubmissionStatus' => 'unverified', 'googleProcessingStatus' => 'unverified',
        ];
        try {
            $contract = self::read_contract(self::directory());
            if (!$contract) return $result;
            $result['generated'] = true;
            $result['enabled'] = !empty($contract['enabled']) && (bool) get_option('blog_public', 1);
            $result['release'] = (string) $contract['release'];
            $result['generatedAt'] = (string) $contract['generatedAt'];
            $result['urlCount'] = self::documents($contract, self::cms_entries($contract))['urlCount'];
        } catch (Throwable $error) {
            $result['validationErrors'][] = $error->getMessage();
        }
        return $result;
    }

    public static function robots(string $output, bool $public): string {
        try { $contract = self::read_contract(self::directory()); }
        catch (Throwable $error) { return $output; }
        if (!$contract) return $output;
        $own = rtrim(home_url('/'), '/') . '/sitemap.xml';
        $seen = [];
        $lines = [];
        foreach (preg_split('/\r\n|\r|\n/', $output) ?: [] as $line) {
            if (preg_match('/^\s*Sitemap\s*:\s*(\S+)\s*$/i', $line, $match)) {
                $url = $match[1];
                if ($url === $own || isset($seen[$url])) continue;
                $seen[$url] = true;
            }
            $lines[] = $line;
        }
        if ($public && !empty($contract['enabled'])) $lines[] = 'Sitemap: ' . $own;
        return rtrim(implode("\n", $lines)) . "\n";
    }

    /** Keep the native sitemap for genuine WordPress routes while removing
     * Onun Kodety mirrors/templates, whose indexability is owned by this inventory. */
    public static function wordpress_query(array $args, string $type): array {
        try { $contract = self::read_contract(self::directory()); }
        catch (Throwable $error) { return $args; }
        if (!$contract) return $args;
        $live_mappings = self::live_template_mappings($contract);
        $managed_types = $live_mappings === null
            ? (array) ($contract['managedPostTypes'] ?? array_keys($contract['templates']))
            : array_keys($live_mappings);
        if (in_array($type, $managed_types, true)) { $args['post__in'] = [0]; return $args; }
        if ($type === 'page') {
            $existing = is_array($args['meta_query'] ?? null) ? $args['meta_query'] : [];
            $args['meta_query'] = ['relation' => 'AND', ['key' => '_kodety_html_path', 'compare' => 'NOT EXISTS']];
            if ($existing) $args['meta_query'][] = $existing;
        }
        return $args;
    }
}
