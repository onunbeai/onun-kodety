<?php

/** Hosted preview link-routing contract. */
define('ABSPATH', __DIR__);

function trailingslashit(string $value): string {
    return rtrim($value, '/') . '/';
}

function home_url(string $path = ''): string {
    return 'https://example.test/wordpress/' . ltrim($path, '/');
}

function wp_json_encode(mixed $value, int $flags = 0, int $depth = 512): string|false {
    return json_encode($value, $flags, $depth);
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_preview_navigation_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

$reflection = new ReflectionClass(Kodety_Plugin::class);
$plugin = $reflection->newInstanceWithoutConstructor();
$runtime_method = $reflection->getMethod('project_preview_navigation_runtime');
$token = str_repeat('a', 48);
$site_base = (string) (getenv('KODETY_PREVIEW_RUNTIME_SITE_BASE') ?: 'https://example.test/wordpress/');
$runtime = $runtime_method->invoke(
    $plugin,
    'https://example.test/wordpress/kodety/preview/' . $token . '/',
    $token,
    $site_base
);

if (getenv('KODETY_PREVIEW_RUNTIME_DUMP') === '1') {
    echo $runtime;
    exit;
}

kodety_preview_navigation_assert(
    str_contains($runtime, 'sitePath=site.pathname')
        && str_contains($runtime, 'path.indexOf(sitePath)===0'),
    'runtime deve remover o subdiretório da instalação antes de prefixar o token'
);
kodety_preview_navigation_assert(
    str_contains($runtime, wp_json_encode(trailingslashit($site_base))),
    'runtime deve usar a base pública do projeto ativo, inclusive em Agency'
);
kodety_preview_navigation_assert(
    str_contains($runtime, 'var legacy="kodety/preview/"')
        && str_contains($runtime, 'var scoped=token+"/"'),
    'runtime deve normalizar URLs de preview legadas e já tokenizadas'
);
kodety_preview_navigation_assert(
    str_contains($runtime, 'a[href],area[href]')
        && str_contains($runtime, 'new MutationObserver')
        && str_contains($runtime, 'attributeFilter:["href"]'),
    'links iniciais e links dinâmicos de CMS/localização devem ser reescritos'
);
kodety_preview_navigation_assert(
    str_contains($runtime, '["click","auxclick"]')
        && str_contains($runtime, 'event.composedPath')
        && str_contains($runtime, 'if(anchor)rewrite(anchor)},true)'),
    'fallback de click e clique do meio deve rodar em capture antes da ação padrão do navegador'
);
kodety_preview_navigation_assert(
    !str_contains($runtime, 'preventDefault')
        && !str_contains($runtime, 'location.href='),
    'target, modificadores e download devem permanecer sob semântica nativa'
);
kodety_preview_navigation_assert(
    str_contains($runtime, 'raw.charAt(0)==="#"')
        && str_contains($runtime, 'scheme&&!/^https?$/i.test(scheme)')
        && str_contains($runtime, 'u.origin!==base.origin'),
    'âncoras, protocolos especiais e links externos não devem ser capturados'
);

echo "Hosted preview navigation runtime approved.\n";
