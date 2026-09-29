<?php

/**
 * Availability regression for large imported Framer documents.
 *
 * Run with:
 * php -d memory_limit=16M Wordpress/tests/hosting-fast-path-runtime.php
 */

define('ABSPATH', __DIR__);

function add_action(...$arguments): void {}
function add_filter(...$arguments): void {}
function add_theme_support(...$arguments): void {}
function is_singular(...$arguments): bool { return true; }
function get_template_directory(): string { return __DIR__; }
function home_url(string $path = ''): string { return 'https://example.test/' . ltrim($path, '/'); }
function user_trailingslashit(string $value): string { return rtrim($value, '/') . '/'; }
function esc_attr(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

require dirname(__DIR__) . '/kodety/theme-runtime/functions.php';

function kodety_hosting_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

$framer_node = '<div class="framer-a1b2c3" data-kodety-framer-node="node-1" '
    . 'data-kodety-framer-motion="visible"><svg viewBox="0 0 100 20"><path d="M0 10 L100 10"></path></svg>'
    . '<span>Imported Framer content</span></div>';
$baseline_payload = str_repeat(
    '{"node":"node-1","marker":"data-kodety-framer-node","literal":"</head>","values":[1,2,3]},',
    3500
);
$fixture = '<!doctype html><html lang="pt-BR"><head><title>Framer fixture</title></head><body>'
    . str_repeat($framer_node, 5200)
    . '<script type="application/json" data-kodety-framer-baseline>[' . $baseline_payload . ']</script>'
    . '<script data-kodety-framer-edit-guard>window.__framerGuard=true;</script>'
    . '</body></html>';

kodety_hosting_assert(
    strlen($fixture) > 1_000_000,
    'o fixture Framer de disponibilidade deve exceder 1 MB'
);
kodety_hosting_assert(
    kodety_cms_html_requires_dom($fixture) === false,
    'marcadores data-kodety-framer-* não podem acionar o DOM de CMS'
);
$cms_output = kodety_render_cms_html($fixture);
kodety_hosting_assert(
    $cms_output === $fixture,
    'o fast-path CMS deve devolver um documento Framer sem bindings byte a byte'
);

$settings = [
    'sourceLocale' => 'pt-BR',
    'defaultLocale' => 'pt-BR',
    'translatePagePaths' => false,
    'locales' => [[
        'code' => 'pt-BR',
        'language' => 'pt',
        'slug' => '',
        'enabled' => true,
        'direction' => 'ltr',
    ]],
    'translations' => [],
];
kodety_hosting_assert(
    kodety_localization_html_requires_dom($fixture, [], []) === false,
    'locale de origem sem traduções não pode acionar o DOM de localização'
);
$localized = kodety_render_localized_html($fixture, 'index.html', 'pt-BR', $settings);
kodety_hosting_assert(
    substr_count($localized, 'data-kodety-framer-node="node-1"') === 5200,
    'o fast-path de locale deve preservar todos os nós importados'
);
kodety_hosting_assert(
    str_contains($localized, $baseline_payload),
    'payloads raw-text do Framer devem permanecer byte a byte'
);
kodety_hosting_assert(
    str_contains($localized, '<html lang="pt-BR" dir="ltr">')
        && str_contains($localized, 'hreflang="pt-BR"')
        && str_contains($localized, 'hreflang="x-default"'),
    'o caminho leve deve preservar lang, dir e hreflang'
);

fwrite(
    STDOUT,
    'Hosting fast-path: fixture Framer '
        . strlen($fixture)
        . ' bytes aprovado com pico PHP '
        . memory_get_peak_usage(true)
        . " bytes.\n"
);
