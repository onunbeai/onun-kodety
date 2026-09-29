<?php

defined('ABSPATH') || exit;

/**
 * Extension state is authoritative even though the bundled PHP class remains
 * available in the main Onun Kodety package.
 */
function kodety_membership_extension_active(): bool {
    if (class_exists('Kodety_Extensions')) {
        return Kodety_Extensions::instance()->is_active('kodety-membership');
    }
    return class_exists('Kodety_Members');
}

/**
 * Load the server-only membership payload generated during publish.
 *
 * The authored protected HTML never lives in `/site`; it is projected into a
 * guarded PHP return value so direct HTTP requests cannot read it.
 *
 * @return array<string,mixed>
 */
function kodety_membership_runtime(string $relative = ''): array {
    if (!kodety_membership_extension_active()) return [];
    static $index = null;
    if (!is_array($index)) {
    $path = function_exists('kodety_runtime_directory')
        ? kodety_runtime_directory() . '/membership-content.php'
        : get_template_directory() . '/membership-content.php';
    $candidate = is_file($path) ? include $path : [];
        $index = is_array($candidate)
        && (int) ($candidate['version'] ?? 0) === 1
        && ($candidate['enabled'] ?? false) === true
            && (
                is_array($candidate['pages'] ?? null)
                || is_array($candidate['pageFiles'] ?? null)
            )
        ? $candidate
        : [];
    }
    if (!$index) return [];
    // Legacy generated themes stored all pages in the index. Preserve them
    // across plugin updates and rollbacks.
    if (is_array($index['pages'] ?? null)) return $index;
    $normalized = kodety_membership_normalize_page_path($relative);
    $filename = $index['pageFiles'][$normalized] ?? '';
    if (
        !is_string($filename)
        || !preg_match('/^[a-f0-9]{64}\.php$/', $filename)
    ) {
        return $index + ['pages' => []];
    }
    $page_path = (function_exists('kodety_runtime_directory') ? kodety_runtime_directory() : get_template_directory())
        . '/membership-pages/' . $filename;
    $page = is_file($page_path) ? include $page_path : null;
    return $index + ['pages' => is_array($page) ? [$normalized => $page] : []];
}

function kodety_membership_normalize_page_path(string $path): string {
    $path = ltrim(str_replace('\\', '/', trim($path)), '/');
    $parts = [];
    foreach (explode('/', $path) as $part) {
        if ($part === '' || $part === '.') continue;
        if ($part === '..') {
            array_pop($parts);
            continue;
        }
        $parts[] = $part;
    }
    return implode('/', $parts);
}

/** @return array<string,mixed> */
function kodety_membership_denied_decision(string $reason): array {
    return ['allowed' => false, 'valid' => false, 'reason' => $reason];
}

function kodety_membership_current_member_id(): int {
    if (
        !kodety_membership_extension_active()
        || !class_exists('Kodety_Members')
        || !method_exists('Kodety_Members', 'current_member_id')
    ) return 0;
    try {
        return max(0, (int) Kodety_Members::current_member_id());
    } catch (Throwable) {
        return 0;
    }
}

/**
 * Evaluate through the plugin-owned identity domain. Missing or incompatible
 * plugin code always fails closed.
 *
 * @param array<string,mixed> $rule
 * @return array<string,mixed>
 */
function kodety_membership_evaluate(array $rule, string $project_id): array {
    if (
        !kodety_membership_extension_active()
        || !class_exists('Kodety_Members')
        || !method_exists('Kodety_Members', 'evaluate_access')
    ) {
        return kodety_membership_denied_decision('membership_runtime_unavailable');
    }
    try {
        $decision = Kodety_Members::evaluate_access(
            $rule,
            kodety_membership_current_member_id() ?: null,
            $project_id
        );
    } catch (Throwable) {
        return kodety_membership_denied_decision('membership_evaluation_failed');
    }
    return is_array($decision) && array_key_exists('allowed', $decision)
        ? $decision
        : kodety_membership_denied_decision('membership_invalid_decision');
}

/** Prevent shared caches from serving one member's response to another. */
function kodety_membership_disable_page_cache(bool $noindex = false): void {
    if (!defined('DONOTCACHEPAGE')) define('DONOTCACHEPAGE', true);
    if (!defined('DONOTCACHEDB')) define('DONOTCACHEDB', true);
    if (!defined('DONOTMINIFY')) define('DONOTMINIFY', true);
    if (function_exists('nocache_headers')) nocache_headers();
    if (!headers_sent()) {
        header('Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0', true);
        header('Pragma: no-cache', true);
        header('Vary: Cookie', false);
        if ($noindex) header('X-Robots-Tag: noindex, nofollow', true);
    }
}

/**
 * Return the fallback selected for the current authentication state.
 *
 * @param array<string,mixed> $rule
 * @return array<string,mixed>
 */
function kodety_membership_fallback(array $rule, array $decision): array {
    // Invalid policy/runtime states never render an authored fallback that
    // could accidentally imply access; they remain closed and invisible.
    if (($decision['valid'] ?? false) !== true) return ['type' => 'hide'];
    $key = kodety_membership_current_member_id() > 0 ? 'denied' : 'anonymous';
    $fallback = is_array($rule[$key] ?? null) ? $rule[$key] : [];
    $type = sanitize_key((string) ($fallback['type'] ?? 'hide'));
    if ($type === 'branch') {
        $branch = sanitize_key((string) ($fallback['branch'] ?? ''));
        return in_array($branch, ['guest', 'upgrade'], true)
            ? ['type' => 'branch', 'branch' => $branch]
            : ['type' => 'hide'];
    }
    if ($type === 'redirect') {
        return ['type' => 'redirect', 'url' => trim((string) ($fallback['url'] ?? ''))];
    }
    return ['type' => 'hide'];
}

function kodety_membership_safe_redirect(string $target): bool {
    $target = trim($target);
    if (
        $target === ''
        || headers_sent()
        || str_starts_with($target, '//')
        || preg_match('/[\x00-\x20\x7f]/', $target)
    ) return false;
    $target_host = strtolower((string) wp_parse_url($target, PHP_URL_HOST));
    $home_host = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
    $external = $target_host !== '' && ($home_host === '' || !hash_equals($home_host, $target_host));
    if ($external) {
        if (
            strtolower((string) wp_parse_url($target, PHP_URL_SCHEME)) !== 'https'
            || (string) wp_parse_url($target, PHP_URL_USER) !== ''
            || (string) wp_parse_url($target, PHP_URL_PASS) !== ''
        ) return false;
        $validated = esc_url_raw($target, ['https']);
    } else {
        $validated = wp_validate_redirect($target, '');
    }
    if ($validated === '') return false;
    $current_path = (string) wp_parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $target_path = (string) wp_parse_url($validated, PHP_URL_PATH);
    if ($target_path !== '' && untrailingslashit($current_path) === untrailingslashit($target_path)) {
        return false;
    }
    $redirected = $external
        ? wp_redirect($validated, 302, 'Onun Kodety Membership')
        : wp_safe_redirect($validated, 302, 'Onun Kodety Membership');
    if (!$redirected) return false;
    exit;
}

/** @return list<string> */
function kodety_membership_authored_favicon_links(string $html): array {
    $candidates = [];
    if (function_exists('kodety_authored_favicon_link_tags')) {
        $candidates = kodety_authored_favicon_link_tags($html);
    } elseif (
        $html !== ''
        && preg_match('~<head\b[^>]*>[\s\S]*?</head\s*>~i', $html, $head_match)
    ) {
        $head = (string) preg_replace(
            [
                '~<(script|style|template|noscript)\b[^>]*>[\s\S]*?</\1\s*>~i',
                '~<!--[\s\S]*?-->~',
            ],
            '',
            $head_match[0]
        );
        if (preg_match_all('~<link\b[^>]*>~i', $head, $link_matches)) {
            $candidates = $link_matches[0];
        }
    }

    $favicons = [];
    foreach ($candidates as $tag) {
        $attribute = static function (string $name) use ($tag): ?string {
            if (function_exists('kodety_runtime_tag_attribute_value')) {
                return kodety_runtime_tag_attribute_value($tag, $name);
            }
            $name = preg_quote($name, '~');
            if (!preg_match(
                '~(?:^|\s)' . $name . '\s*=\s*(?:(["\'])(.*?)\1|([^\s"\'=<>`]+))~is',
                $tag,
                $match
            )) return null;
            return html_entity_decode(
                (string) (($match[2] ?? '') !== '' ? $match[2] : ($match[3] ?? '')),
                ENT_QUOTES | ENT_HTML5,
                'UTF-8'
            );
        };
        $rel = trim((string) $attribute('rel'));
        $relations = preg_split('/\s+/', strtolower($rel)) ?: [];
        $href = trim((string) $attribute('href'));
        $scheme = preg_match('~^([a-z][a-z0-9+.-]*):~i', $href, $scheme_match)
            ? strtolower((string) ($scheme_match[1] ?? ''))
            : '';
        if (
            !in_array('icon', $relations, true)
            || $href === ''
            || strlen($href) > 8192
            || preg_match('/[\x00-\x20\x7f]/', $href)
            || ($scheme !== '' && !in_array($scheme, ['http', 'https', 'data'], true))
            || (
                $scheme === 'data'
                && !preg_match(
                    '~^data:image/(?:avif|gif|jpe?g|png|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)(?:[;,])~i',
                    $href
                )
            )
        ) continue;

        $attributes = [
            'rel' => in_array('shortcut', $relations, true) ? 'shortcut icon' : 'icon',
            'href' => $href,
        ];
        $type = trim((string) $attribute('type'));
        if ($type !== '' && strlen($type) <= 100 && preg_match('~^image/[a-z0-9.+-]+$~i', $type)) {
            $attributes['type'] = strtolower($type);
        }
        $sizes = trim((string) $attribute('sizes'));
        if ($sizes !== '' && strlen($sizes) <= 200 && preg_match('~^(?:any|\d+x\d+)(?:\s+(?:any|\d+x\d+))*$~i', $sizes)) {
            $attributes['sizes'] = strtolower($sizes);
        }
        $media = trim((string) $attribute('media'));
        if (in_array($media, ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)'], true)) {
            $attributes['media'] = $media;
        }
        $crossorigin = strtolower(trim((string) $attribute('crossorigin')));
        if (in_array($crossorigin, ['anonymous', 'use-credentials'], true)) {
            $attributes['crossorigin'] = $crossorigin;
        }
        $role = strtolower(trim((string) $attribute('data-kodety-favicon')));
        if (in_array($role, ['light', 'dark', 'fallback'], true)) {
            $attributes['data-kodety-favicon'] = $role;
        }
        $serialized = '';
        foreach ($attributes as $name => $value) {
            $serialized .= ' ' . $name . '="' . htmlspecialchars(
                $value,
                ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5,
                'UTF-8'
            ) . '"';
        }
        $favicons[] = '<link' . $serialized . '>';
        if (count($favicons) >= 8) break;
    }
    return array_values(array_unique($favicons));
}

/** @param list<string> $favicon_links */
function kodety_membership_empty_page_fallback(array $favicon_links = []): string {
    return '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="robots" content="noindex,nofollow">'
        . implode('', $favicon_links)
        . '<title></title></head><body></body></html>';
}

/** @param list<string> $favicon_links */
function kodety_membership_default_page_fallback(string $branch, array $favicon_links = []): string {
    $guest = $branch === 'guest';
    $title = $guest ? 'Conteúdo exclusivo para membros' : 'Este conteúdo requer outro plano';
    $message = $guest
        ? 'Entre ou crie sua conta para continuar.'
        : 'Faça upgrade do seu plano para liberar este conteúdo.';
    $settings = class_exists('Kodety_Members') && method_exists('Kodety_Members', 'settings')
        ? Kodety_Members::settings()
        : [];
    $target = trim((string) (
        $guest
            ? ($settings['login_page_url'] ?? '')
            : ($settings['upgrade_page_url'] ?? '')
    ));
    $action = $target !== ''
        ? '<p><a href="' . esc_url($target) . '">'
            . esc_html($guest ? 'Entrar' : 'Ver opções de upgrade')
            . '</a></p>'
        : '';
    return '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="robots" content="noindex,nofollow">'
        . implode('', $favicon_links)
        . '<title>'
        . esc_html($title)
        . '</title></head><body><main data-kodety-membership-fallback="'
        . esc_attr($branch)
        . '"><h1>'
        . esc_html($title)
        . '</h1><p>'
        . esc_html($message)
        . '</p>'
        . $action
        . '</main></body></html>';
}

/**
 * Resolve element placeholders, including gates nested in protected branches.
 *
 * @param array<string,array<string,mixed>> $gates
 */
function kodety_membership_render_gates(
    string $html,
    array $gates,
    string $project_id
): string {
    if ($html === '' || !$gates || !str_contains($html, 'data-kodety-access-placeholder')) {
        return $html;
    }
    $pattern = '~<div\b(?=[^>]*\bdata-kodety-access-placeholder\s*=\s*(["\'])([^"\']+)\1)[^>]*>\s*</div\s*>~i';
    $passes = min(2001, count($gates) + 1);
    for ($pass = 0; $pass < $passes && str_contains($html, 'data-kodety-access-placeholder'); $pass++) {
        $before = $html;
        $html = (string) preg_replace_callback(
            $pattern,
            static function (array $match) use ($gates, $project_id): string {
                $instance_id = html_entity_decode((string) ($match[2] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                $gate = $gates[$instance_id] ?? null;
                if (!is_array($gate) || !is_array($gate['rule'] ?? null)) return '';
                $decision = kodety_membership_evaluate($gate['rule'], $project_id);
                if (($decision['allowed'] ?? false) === true) {
                    return is_string($gate['protectedHtml'] ?? null) ? $gate['protectedHtml'] : '';
                }
                $fallback = kodety_membership_fallback($gate['rule'], $decision);
                if (($fallback['type'] ?? '') === 'redirect') {
                    kodety_membership_safe_redirect((string) ($fallback['url'] ?? ''));
                    return '';
                }
                if (($fallback['type'] ?? '') !== 'branch') return '';
                $key = ($fallback['branch'] ?? '') === 'upgrade' ? 'upgradeHtml' : 'guestHtml';
                return is_string($gate[$key] ?? null) ? $gate[$key] : '';
            },
            $html
        );
        if ($html === $before) break;
    }
    // Unknown, cyclic or malformed placeholders must never survive to the
    // browser. The transport emits only empty div placeholders.
    return (string) preg_replace($pattern, '', $html);
}

/** Replace opaque protected-download markers only after access was granted. */
function kodety_membership_rewrite_asset_links(
    string $html,
    array $assets
): string {
    if ($html === '' || !$assets || !str_contains($html, 'data-kodety-protected-asset')) {
        return $html;
    }
    $release = function_exists('kodety_runtime_release')
        ? kodety_runtime_release()
        : (string) get_option('kodety_current_release', '');
    if ($release === '') return (string) preg_replace(
        '~<a\b[^>]*\bdata-kodety-protected-asset\s*=\s*(["\'])[^"\']+\1[^>]*>[\s\S]*?</a\s*>~i',
        '',
        $html
    );
    return (string) preg_replace_callback(
        '~<a\b(?=[^>]*\bdata-kodety-protected-asset\s*=\s*(["\'])([^"\']+)\1)[^>]*>~i',
        static function (array $match) use ($assets, $release): string {
            $id = html_entity_decode((string) ($match[2] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $asset = $assets[$id] ?? null;
            if (!is_array($asset) || !preg_match('/^asset-[a-f0-9]{24}$/', $id)) return '<a hidden>';
            $url = add_query_arg([
                'kodety_member_asset' => $id,
                'kodety_member_release' => $release,
            ], home_url('/'));
            $tag = $match[0];
            if (preg_match('/\bhref\s*=\s*(["\'])[^"\']*\1/i', $tag)) {
                $tag = (string) preg_replace(
                    '/\bhref\s*=\s*(["\'])[^"\']*\1/i',
                    'href="' . esc_url($url) . '"',
                    $tag,
                    1
                );
            } else {
                $tag = substr($tag, 0, -1) . ' href="' . esc_url($url) . '">';
            }
            if (!preg_match('/\bdownload(?:\s|=|>)/i', $tag)) {
                $filename = sanitize_file_name((string) ($asset['filename'] ?? 'download'));
                $tag = substr($tag, 0, -1) . ' download="' . esc_attr($filename ?: 'download') . '">';
            }
            return $tag;
        },
        $html
    );
}

/** @return array<int,string> */
function kodety_membership_current_audience_layers(): array {
    $member_id = kodety_membership_current_member_id();
    if ($member_id <= 0) return ['guest'];
    $layers = ['member'];
    if (
        !class_exists('Kodety_Members')
        || !method_exists('Kodety_Members', 'instance')
    ) return $layers;
    try {
        $claims = Kodety_Members::instance()->resolve_claims($member_id);
    } catch (Throwable) {
        return $layers;
    }
    $plans = is_array($claims['plans'] ?? null) ? $claims['plans'] : [];
    $keys = [];
    foreach (array_slice($plans, 0, 100) as $raw_key) {
        $key = strtolower(trim((string) $raw_key));
        if (preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/', $key)) {
            $keys[$key] = $key;
        }
    }
    ksort($keys);
    foreach ($keys as $key) $layers[] = 'plan:' . $key;
    return $layers;
}

function kodety_membership_audience_css_value(string $value): string {
    // No literal "<" may reach an inline style element: even a site author
    // controlled value must not be able to terminate the generated tag.
    return str_replace(
        ["\0", '<', '>'],
        ['', '\\3c ', '\\3e '],
        $value
    );
}

/**
 * Apply the real visitor/member/plan layer after protected branches have been
 * resolved. Later plan layers win over the shared member layer.
 *
 * @param array<string,mixed> $page
 */
function kodety_membership_apply_audience_overrides(string $html, array $page): string {
    $stored = is_array($page['audienceOverrides'] ?? null)
        ? $page['audienceOverrides']
        : [];
    if ($html === '' || !$stored || !str_contains($html, 'data-kodety-audience-id')) {
        return $html;
    }
    $merged = [];
    foreach (kodety_membership_current_audience_layers() as $layer) {
        $elements = is_array($stored[$layer] ?? null) ? $stored[$layer] : [];
        foreach (array_slice($elements, 0, 5000, true) as $raw_id => $raw_override) {
            $id = trim((string) $raw_id);
            if (
                !preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/', $id)
                || !is_array($raw_override)
            ) continue;
            $previous = is_array($merged[$id] ?? null) ? $merged[$id] : [];
            $styles = is_array($previous['styles'] ?? null) ? $previous['styles'] : [];
            foreach (array_slice(
                is_array($raw_override['styles'] ?? null) ? $raw_override['styles'] : [],
                0,
                200,
                true
            ) as $raw_property => $raw_value) {
                $property = strtolower(trim((string) $raw_property));
                if (
                    !preg_match('/^(?:--[A-Za-z0-9_-]{1,100}|-?[A-Za-z][A-Za-z0-9-]{0,100})$/', $property)
                    || !is_string($raw_value)
                ) continue;
                $styles[$property] = substr($raw_value, 0, 50000);
            }
            $next = ['styles' => $styles];
            if (array_key_exists('visible', $previous)) {
                $next['visible'] = $previous['visible'] === true;
            }
            if (array_key_exists('visible', $raw_override)) {
                $next['visible'] = $raw_override['visible'] === true;
            }
            $merged[$id] = $next;
        }
    }
    if (!$merged) return $html;

    $rules = [];
    foreach ($merged as $id => $override) {
        if (array_key_exists('visible', $override)) {
            $visible = $override['visible'] === true;
            $quoted_id = preg_quote($id, '~');
            $html = (string) preg_replace_callback(
                '~<[A-Za-z][A-Za-z0-9:-]*\\b(?=[^>]*\\bdata-kodety-audience-id\\s*=\\s*(["\\\'])'
                    . $quoted_id . '\\1)[^>]*>~i',
                static function (array $match) use ($visible): string {
                    $tag = (string) ($match[0] ?? '');
                    $tag = (string) preg_replace(
                        '/\\s+aria-hidden\\s*=\\s*(?:"[^"]*"|\\\'[^\\\']*\\\'|[^\\s>]+)/i',
                        '',
                        $tag
                    );
                    $tag = (string) preg_replace(
                        '/\\s+hidden(?:\\s*=\\s*(?:"[^"]*"|\\\'[^\\\']*\\\'|[^\\s>]+))?/i',
                        '',
                        $tag
                    );
                    return $visible
                        ? $tag
                        : substr($tag, 0, -1) . ' hidden aria-hidden="true">';
                },
                $html
            );
        }
        $declarations = [];
        foreach ((array) ($override['styles'] ?? []) as $property => $value) {
            if (!is_string($property) || !is_string($value)) continue;
            $declarations[] = $property . ':' . kodety_membership_audience_css_value($value);
        }
        if (($override['visible'] ?? null) === false) {
            $declarations[] = 'display:none';
        }
        if ($declarations) {
            $rules[] = '[data-kodety-audience-id="' . $id . '"]{' . implode(';', $declarations) . '}';
        }
    }
    if (!$rules) return $html;
    $style = '<style data-kodety-membership-audience>' . implode('', $rules) . '</style>';
    if (preg_match('/<\\/head\\s*>/i', $html)) {
        return (string) preg_replace('/<\\/head\\s*>/i', $style . '</head>', $html, 1);
    }
    return $style . $html;
}

/**
 * Inject the authorized server-side branch for one generated HTML document.
 * Pages absent from the runtime retain the exact pre-membership fast path.
 */
function kodety_render_membership_html(string $html, string $relative): string {
    $path = kodety_membership_normalize_page_path($relative);
    $runtime = kodety_membership_runtime($path);
    if (!$runtime) return $html;
    $page = $runtime['pages'][$path] ?? null;
    if (!is_array($page)) return $html;

    $protected_html = is_string($page['protectedHtml'] ?? null) ? $page['protectedHtml'] : '';
    $favicon_links = kodety_membership_authored_favicon_links($protected_html);
    $project_id = strtolower(trim((string) ($runtime['projectId'] ?? '')));
    if ($project_id === '') return kodety_membership_empty_page_fallback($favicon_links);
    $page_rule = is_array($page['pageRule'] ?? null) ? $page['pageRule'] : null;
    kodety_membership_disable_page_cache($page_rule !== null);

    if ($page_rule !== null) {
        $decision = kodety_membership_evaluate($page_rule, $project_id);
        if (($decision['allowed'] ?? false) === true) {
            $html = $protected_html;
        } else {
            $fallback = kodety_membership_fallback($page_rule, $decision);
            if (($fallback['type'] ?? '') === 'redirect') {
                kodety_membership_safe_redirect((string) ($fallback['url'] ?? ''));
            }
            if (($fallback['type'] ?? '') !== 'branch') {
                return kodety_membership_empty_page_fallback($favicon_links);
            }
            $html = kodety_membership_default_page_fallback(
                ($fallback['branch'] ?? '') === 'upgrade' ? 'upgrade' : 'guest',
                $favicon_links
            );
        }
    }

    $gates = is_array($page['gates'] ?? null) ? $page['gates'] : [];
    $html = kodety_membership_render_gates($html, $gates, $project_id);
    $html = kodety_membership_apply_audience_overrides($html, $page);
    $assets = is_array($runtime['assets'] ?? null) ? $runtime['assets'] : [];
    return kodety_membership_rewrite_asset_links($html, $assets);
}

/**
 * Attach the credential-aware member form runtime only to pages that use it.
 * Generic lead capture intentionally never sees these form payloads.
 */
function kodety_inject_membership_runtime(string $html): string {
    if (!kodety_membership_extension_active()) return $html;
    if (
        !str_contains($html, 'data-kodety-member-form')
        && !str_contains($html, 'data-kodety-form-action')
    ) {
        return $html;
    }
    if (
        str_contains($html, 'data-kodety-membership-runtime')
        || !class_exists('Kodety_Members')
        || !defined('KODETY_URL')
        || !method_exists('Kodety_Members', 'is_current_project_enabled')
        || !Kodety_Members::is_current_project_enabled()
    ) {
        return $html;
    }
    kodety_membership_disable_page_cache(false);
    $settings = method_exists('Kodety_Members', 'settings') ? Kodety_Members::settings() : [];
    $config = [
        'challengeUrl' => rest_url('kodety/v1/membership/auth/challenge'),
        'endpoints' => [
            'login' => rest_url('kodety/v1/membership/auth/login'),
            'register' => rest_url('kodety/v1/membership/auth/register'),
            'forgot-password' => rest_url('kodety/v1/membership/auth/forgot'),
            'reset-password' => rest_url('kodety/v1/membership/auth/reset'),
            'profile' => rest_url('kodety/v1/membership/me'),
            'logout' => rest_url('kodety/v1/membership/auth/logout'),
        ],
        'memberCsrf' => method_exists('Kodety_Members', 'current_member_csrf_token')
            ? Kodety_Members::current_member_csrf_token()
            : '',
        'registrationEnabled' => !empty($settings['registration_enabled']),
        'afterLoginUrl' => (string) ($settings['after_login_url'] ?? ''),
        'afterLogoutUrl' => (string) ($settings['after_logout_url'] ?? ''),
    ];
    $json = wp_json_encode($config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (!is_string($json)) return $html;
    $runtime_url = KODETY_URL . 'assets/membership-runtime.js?ver=' . rawurlencode(KODETY_VERSION);
    if (function_exists('apply_filters')) {
        $runtime_url = (string) apply_filters('kodety_membership_runtime_url', $runtime_url);
    }
    $markup = '<script data-kodety-membership-config>window.kodetyMembership='
        . str_replace('</', '<\/', $json)
        . ';</script><script src="'
        . esc_url($runtime_url)
        . '" defer data-kodety-membership-runtime></script>';
    return preg_match('/<\/body\s*>/i', $html)
        ? (string) preg_replace('/<\/body\s*>/i', $markup . '</body>', $html, 1)
        : $html . $markup;
}
