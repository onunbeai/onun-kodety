<?php
defined('ABSPATH') || exit;

/**
 * Redirects are published as a deliberately small public payload. The complete
 * editor metadata remains private in `.incode/project.json`.
 */
function kodety_redirect_settings(): array {
    if (class_exists('Kodety_Edition') && !Kodety_Edition::has('redirects')) {
        return ['version' => 1, 'entries' => []];
    }
    static $settings = null;
    if (is_array($settings)) return $settings;
    $path = function_exists('kodety_runtime_directory')
        ? kodety_runtime_directory() . '/redirects.json'
        : get_template_directory() . '/redirects.json';
    $decoded = is_file($path) ? json_decode((string) file_get_contents($path), true) : [];
    $settings = kodety_normalize_redirect_settings(is_array($decoded) ? $decoded : []);
    return $settings;
}

function kodety_redirect_boolean(mixed $value, bool $fallback = true): bool {
    if ($value === null) return $fallback;
    if (is_string($value)) {
        $normalized = strtolower(trim($value));
        if (in_array($normalized, ['', '0', 'false', 'no', 'off'], true)) return false;
        if (in_array($normalized, ['1', 'true', 'yes', 'on'], true)) return true;
    }
    return (bool) $value;
}

/** Normalize legacy aliases at the runtime boundary without widening the
 * canonical editor contract. Disabled and invalid entries never execute. */
function kodety_normalize_redirect_settings(array $settings): array {
    $entries = is_array($settings['entries'] ?? null)
        ? $settings['entries']
        : (is_array($settings['redirects'] ?? null) ? $settings['redirects'] : []);
    $normalized = [];
    foreach (array_slice($entries, 0, 2000) as $index => $entry) {
        if (!is_array($entry)) continue;
        $enabled = array_key_exists('enabled', $entry)
            ? kodety_redirect_boolean($entry['enabled'])
            : true;
        if (!$enabled) continue;
        $source = trim((string) ($entry['source'] ?? $entry['from'] ?? $entry['sourcePath'] ?? ''));
        $destination = trim((string) ($entry['destination'] ?? $entry['to'] ?? $entry['target'] ?? ''));
        $raw_match = $entry['match'] ?? $entry['matchType'] ?? null;
        $match = strtolower(trim((string) ($raw_match ?? '')));
        $status = (int) ($entry['status'] ?? $entry['statusCode'] ?? $entry['code'] ?? 301);
        $preserve_query = array_key_exists('preserveQuery', $entry)
            ? kodety_redirect_boolean($entry['preserveQuery'])
            : (array_key_exists('keepQuery', $entry) ? kodety_redirect_boolean($entry['keepQuery']) : true);
        if (!in_array($match, ['exact', 'prefix', 'wildcard'], true)) {
            $match = match ($match) {
                'starts-with', 'path-prefix' => 'prefix',
                'glob', 'pattern' => 'wildcard',
                default => $raw_match === null && str_contains($source, '*') ? 'wildcard' : 'exact',
            };
        }
        if (!in_array($status, [301, 302, 307, 308], true)) $status = 301;
        $source = kodety_normalize_redirect_source($source, $match);
        if (
            $source === ''
            || $destination === ''
            || ($match === 'wildcard' && !str_contains($source, '*'))
            || ($match !== 'wildcard' && str_contains($source, '*'))
            || preg_match('/\s/u', $source)
            || strlen($source) > 2048
            || strlen($destination) > 4096
            || str_contains($destination, "\r")
            || str_contains($destination, "\n")
            || !kodety_redirect_destination_is_safe($destination)
        ) continue;
        $normalized[] = [
            'id' => substr(preg_replace('/[^a-zA-Z0-9_-]+/', '-', (string) ($entry['id'] ?? 'redirect-' . $index)) ?: 'redirect-' . $index, 0, 96),
            'source' => $source,
            'destination' => $destination,
            'match' => $match,
            'status' => $status,
            'preserveQuery' => $preserve_query,
            'enabled' => true,
        ];
    }
    return ['version' => 1, 'entries' => $normalized];
}

/** Path comparison ignores a trailing slash, matching WordPress' public route
 * behavior, while wildcard tokens remain available to the matcher. */
function kodety_normalize_redirect_source(string $source, string $match = 'exact'): string {
    if ($source === '' || str_contains($source, "\r") || str_contains($source, "\n")) return '';
    if (preg_match('~^[a-z][a-z0-9+.-]*://~i', $source)) {
        $source = (string) (parse_url($source, PHP_URL_PATH) ?? '');
    } else {
        $source = (string) (parse_url($source, PHP_URL_PATH) ?? $source);
    }
    // Canonicalize encoded and literal Unicode paths exactly like the editor
    // resolver. Decoding before segment normalization also prevents an encoded
    // dot-segment from bypassing protected-route checks.
    $source = rawurldecode(str_replace('\\', '/', $source));
    if (!str_starts_with($source, '/')) $source = '/' . $source;
    $segments = [];
    foreach (explode('/', $source) as $segment) {
        if ($segment === '' || $segment === '.') continue;
        if ($segment === '..') {
            array_pop($segments);
            continue;
        }
        $segments[] = $segment;
    }
    $normalized = '/' . implode('/', $segments);
    return $normalized === '' ? '/' : ($normalized !== '/' ? rtrim($normalized, '/') : '/');
}

function kodety_redirect_destination_is_safe(string $destination): bool {
    if ($destination === '' || preg_match('/\s/u', $destination) || str_contains($destination, "\r") || str_contains($destination, "\n")) return false;
    if (str_starts_with($destination, '//')) return false;
    $parsed = parse_url($destination);
    if ($parsed === false || isset($parsed['user']) || isset($parsed['pass'])) return false;
    if (isset($parsed['scheme'])) {
        return in_array(strtolower((string) $parsed['scheme']), ['http', 'https'], true)
            && is_string($parsed['host'] ?? null)
            && $parsed['host'] !== '';
    }
    return !str_contains((string) ($parsed['path'] ?? ''), "\0");
}

/** Extract a site-relative public route from REQUEST_URI, including support
 * for WordPress installed below a subdirectory. */
function kodety_redirect_request_path(string $request_uri, string $site_home = ''): string {
    $path = (string) (parse_url($request_uri, PHP_URL_PATH) ?? '/');
    $home_path = $site_home !== '' ? (string) (parse_url($site_home, PHP_URL_PATH) ?? '') : '';
    $home_path = '/' . trim(str_replace('\\', '/', $home_path), '/');
    if ($home_path !== '/' && ($path === $home_path || str_starts_with($path, $home_path . '/'))) {
        $path = (string) substr($path, strlen($home_path));
    }
    return kodety_normalize_redirect_source($path, 'exact');
}

function kodety_redirect_is_reserved_path(string $path): bool {
    $path = strtolower(kodety_normalize_redirect_source($path, 'exact'));
    foreach (['/wp-admin', '/wp-login.php', '/wp-json', '/xmlrpc.php', '/wp-content', '/wp-includes', '/kodety'] as $reserved) {
        if ($path === $reserved || str_starts_with($path, $reserved . '/')) return true;
    }
    return false;
}

function kodety_redirect_is_asset_path(string $path): bool {
    $extension = strtolower(pathinfo((string) (parse_url($path, PHP_URL_PATH) ?? ''), PATHINFO_EXTENSION));
    if ($extension === '' || in_array($extension, ['html', 'htm'], true)) return false;
    return in_array($extension, [
        'css', 'js', 'mjs', 'cjs', 'map', 'json', 'xml', 'txt', 'webmanifest',
        'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp',
        'woff', 'woff2', 'ttf', 'otf', 'eot',
        'mp3', 'mp4', 'm4a', 'm4v', 'mov', 'webm', 'ogg', 'wav',
        'pdf', 'zip', 'gz', 'rar', '7z', 'wasm', 'bin',
    ], true);
}

/** Return concrete captures for one rule. Prefix captures its unmatched tail;
 * wildcard supports one or more `*` tokens in source order. */
function kodety_match_redirect_entry(array $entry, string $request_path): ?array {
    $source = (string) ($entry['source'] ?? '');
    $match = (string) ($entry['match'] ?? 'exact');
    $request_path = kodety_normalize_redirect_source($request_path, 'exact');
    if ($match === 'exact') return strcasecmp($source, $request_path) === 0 ? ['captures' => [], 'suffix' => ''] : null;
    if ($match === 'prefix') {
        $source_lower = strtolower($source);
        $request_lower = strtolower($request_path);
        if ($source !== '/' && $request_lower !== $source_lower && !str_starts_with($request_lower, $source_lower . '/')) return null;
        $suffix = $source === '/' ? ltrim($request_path, '/') : ltrim((string) substr($request_path, strlen($source)), '/');
        return ['captures' => [], 'suffix' => $suffix];
    }
    $quoted = preg_quote($source, '~');
    $pattern = '~^' . str_replace('\\*', '(.*)', $quoted) . '$~iu';
    if (preg_match($pattern, $request_path, $matches) !== 1) return null;
    array_shift($matches);
    return ['captures' => array_map('strval', $matches), 'suffix' => ''];
}

function kodety_redirect_rebuild_url(array $parts): string {
    $url = '';
    if (isset($parts['scheme'])) $url .= $parts['scheme'] . '://';
    if (isset($parts['host'])) $url .= $parts['host'];
    if (isset($parts['port'])) $url .= ':' . (int) $parts['port'];
    $url .= (string) ($parts['path'] ?? '');
    if (array_key_exists('query', $parts) && $parts['query'] !== '') $url .= '?' . $parts['query'];
    if (array_key_exists('fragment', $parts)) $url .= '#' . $parts['fragment'];
    return $url;
}

/** Apply wildcard captures or append the unmatched prefix suffix to the
 * destination path. Query and fragment authored on the destination survive. */
function kodety_apply_redirect_match(array $entry, array $matched): string {
    $destination = (string) ($entry['destination'] ?? '');
    $captures = array_values((array) ($matched['captures'] ?? []));
    $capture_index = 0;
    if ($captures && str_contains($destination, '*')) {
        $destination = (string) preg_replace_callback('/\*/', static function () use (&$capture_index, $captures): string {
            $capture = (string) ($captures[$capture_index] ?? end($captures) ?: '');
            $capture_index++;
            return $capture;
        }, $destination);
    }
    $suffix = trim((string) ($matched['suffix'] ?? ''), '/');
    if ($suffix === '') return $destination;
    $parts = parse_url($destination);
    if (!is_array($parts)) return $destination;
    $path = (string) ($parts['path'] ?? '/');
    $parts['path'] = rtrim($path, '/') . '/' . $suffix;
    if (!str_starts_with($parts['path'], '/') && !isset($parts['scheme'])) $parts['path'] = '/' . $parts['path'];
    return kodety_redirect_rebuild_url($parts);
}

function kodety_redirect_query_keys(string $query): array {
    $keys = [];
    foreach (explode('&', $query) as $pair) {
        if ($pair === '') continue;
        $raw_key = explode('=', $pair, 2)[0];
        $keys[rawurldecode(str_replace('+', ' ', $raw_key))] = true;
    }
    return $keys;
}

/** Preserve the source query byte-for-byte where possible. Destination query
 * parameters have precedence over repeated source keys. */
function kodety_merge_redirect_query(string $destination, string $source_query, bool $preserve_query): string {
    if (!$preserve_query || $source_query === '') return $destination;
    $parts = parse_url($destination);
    if (!is_array($parts)) return $destination;
    $target_query = (string) ($parts['query'] ?? '');
    if ($target_query === '') {
        $parts['query'] = $source_query;
        return kodety_redirect_rebuild_url($parts);
    }
    $target_keys = kodety_redirect_query_keys($target_query);
    $preserved = [];
    foreach (explode('&', $source_query) as $pair) {
        if ($pair === '') continue;
        $raw_key = explode('=', $pair, 2)[0];
        $key = rawurldecode(str_replace('+', ' ', $raw_key));
        if (!isset($target_keys[$key])) $preserved[] = $pair;
    }
    if ($preserved) $parts['query'] = $target_query . '&' . implode('&', $preserved);
    return kodety_redirect_rebuild_url($parts);
}

function kodety_redirect_same_origin(string $left, string $right): bool {
    $a = parse_url($left);
    $b = parse_url($right);
    if (!is_array($a) || !is_array($b)) return false;
    $a_scheme = strtolower((string) ($a['scheme'] ?? 'http'));
    $b_scheme = strtolower((string) ($b['scheme'] ?? 'http'));
    $a_port = (int) ($a['port'] ?? ($a_scheme === 'https' ? 443 : 80));
    $b_port = (int) ($b['port'] ?? ($b_scheme === 'https' ? 443 : 80));
    return $a_scheme === $b_scheme
        && strtolower((string) ($a['host'] ?? '')) === strtolower((string) ($b['host'] ?? ''))
        && $a_port === $b_port;
}

function kodety_redirect_absolute_location(string $destination, string $site_home): string {
    if (preg_match('~^https?://~i', $destination)) return $destination;
    $parts = parse_url($destination);
    if (!is_array($parts)) return '';
    $path = (string) ($parts['path'] ?? '/');
    $base = rtrim($site_home, '/');
    $parts['path'] = '/' . ltrim($path, '/');
    $relative = kodety_redirect_rebuild_url($parts);
    return $base . $relative;
}

/** Find the first rule because list order is the explicit redirect priority. */
function kodety_find_redirect(array $settings, string $request_path): ?array {
    foreach ((array) ($settings['entries'] ?? []) as $entry) {
        if (!is_array($entry)) continue;
        $matched = kodety_match_redirect_entry($entry, $request_path);
        if ($matched !== null) return ['entry' => $entry, 'matched' => $matched];
    }
    return null;
}

/** Simulate the concrete internal chain to block self-loops and longer cycles.
 * It intentionally does not collapse safe chains: every authored status and
 * analytics hop remains observable. */
function kodety_redirect_chain_has_cycle(array $settings, string $request_path, string $site_home): bool {
    $visited = [];
    $current = kodety_normalize_redirect_source($request_path, 'exact');
    $limit = max(2, count((array) ($settings['entries'] ?? [])) + 2);
    for ($step = 0; $step < $limit; $step++) {
        if (isset($visited[$current])) return true;
        $visited[$current] = true;
        $resolved = kodety_find_redirect($settings, $current);
        if ($resolved === null) return false;
        $destination = kodety_apply_redirect_match($resolved['entry'], $resolved['matched']);
        $absolute = kodety_redirect_absolute_location($destination, $site_home);
        if ($absolute === '') return false;
        if (preg_match('~^https?://~i', $absolute) && !kodety_redirect_same_origin($absolute, $site_home)) return false;
        $next = kodety_redirect_request_path($absolute, $site_home);
        if (kodety_redirect_is_reserved_path($next) || kodety_redirect_is_asset_path($next)) return false;
        $current = $next;
    }
    return true;
}

/** Pure resolver used by the request hook and isolated regression tests. */
function kodety_resolve_redirect(
    array $settings,
    string $request_uri,
    string $method = 'GET',
    string $site_home = ''
): ?array {
    $method = strtoupper($method);
    if (!in_array($method, ['GET', 'HEAD'], true)) return null;
    $site_home = $site_home !== ''
        ? $site_home
        : (function_exists('kodety_runtime_public_url') ? kodety_runtime_public_url() : home_url('/'));
    $settings = kodety_normalize_redirect_settings($settings);
    $request_path = kodety_redirect_request_path($request_uri, $site_home);
    if (kodety_redirect_is_reserved_path($request_path) || kodety_redirect_is_asset_path($request_path)) return null;
    $resolved = kodety_find_redirect($settings, $request_path);
    if ($resolved === null || kodety_redirect_chain_has_cycle($settings, $request_path, $site_home)) return null;
    $destination = kodety_apply_redirect_match($resolved['entry'], $resolved['matched']);
    $query = (string) (parse_url($request_uri, PHP_URL_QUERY) ?? '');
    $destination = kodety_merge_redirect_query($destination, $query, (bool) ($resolved['entry']['preserveQuery'] ?? true));
    $location = kodety_redirect_absolute_location($destination, $site_home);
    if ($location === '' || !kodety_redirect_destination_is_safe($location)) return null;
    return [
        'location' => $location,
        'status' => (int) $resolved['entry']['status'],
        'id' => (string) $resolved['entry']['id'],
    ];
}

function kodety_redirect_request_is_bypassed(): bool {
    if ((function_exists('is_admin') && is_admin())
        || (function_exists('wp_doing_ajax') && wp_doing_ajax())
        || (function_exists('wp_doing_cron') && wp_doing_cron())
        || (defined('REST_REQUEST') && REST_REQUEST)
        || (defined('XMLRPC_REQUEST') && XMLRPC_REQUEST)
    ) return true;
    return false;
}

/** Run before WordPress' canonical redirect so old or currently missing routes
 * are handled by the project's ordered redirect table. */
function kodety_execute_configured_redirect(): void {
    if (class_exists('Kodety_Edition') && !Kodety_Edition::has('redirects')) return;
    if (kodety_redirect_request_is_bypassed() || headers_sent()) return;
    $result = kodety_resolve_redirect(
        kodety_redirect_settings(),
        (string) ($_SERVER['REQUEST_URI'] ?? '/'),
        (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'),
        function_exists('kodety_runtime_public_url') ? kodety_runtime_public_url() : home_url('/')
    );
    if ($result === null) return;
    wp_redirect((string) $result['location'], (int) $result['status'], 'Onun Kodety Redirect');
    exit;
}

add_action('template_redirect', 'kodety_execute_configured_redirect', -100);
