<?php
/**
 * Leitura do manifest do Vite.
 *
 * Com mais de uma entrada no build, o Vite extrai o CSS comum (o design
 * system) para um chunk compartilhado. Esse CSS não aparece em `css` da
 * entrada — só no chunk importado. Emitir apenas `$entry['css']` deixaria as
 * duas aplicações sem estilo, então a resolução precisa percorrer os imports.
 */

defined('ABSPATH') || exit;

final class Kodety_Assets {
    /**
     * Todas as folhas de estilo necessárias para uma entrada, na ordem em que
     * devem ser carregadas: primeiro as dos chunks compartilhados, por último
     * as da própria entrada, para que o CSS específico vença o genérico.
     *
     * @return string[] Caminhos relativos a `assets/`.
     */
    public static function entry_styles(array $manifest, string $entry): array {
        $styles = [];
        self::collect_styles($manifest, $entry, $styles, []);

        return array_values(array_unique($styles));
    }

    /**
     * @param string[] $styles
     * @param string[] $seen Evita laço infinito em dependência circular.
     */
    private static function collect_styles(array $manifest, string $key, array &$styles, array $seen): void {
        if (in_array($key, $seen, true)) return;
        $seen[] = $key;

        $chunk = $manifest[$key] ?? null;
        if (!is_array($chunk)) return;

        // Profundidade primeiro: o CSS de um chunk importado é mais genérico
        // que o da entrada que o importou.
        foreach ((array) ($chunk['imports'] ?? []) as $import) {
            self::collect_styles($manifest, (string) $import, $styles, $seen);
        }

        foreach ((array) ($chunk['css'] ?? []) as $style) {
            $styles[] = ltrim((string) $style, './');
        }
    }

    public static function entry_script(array $manifest, string $entry): string {
        $chunk = $manifest[$entry] ?? null;
        return is_array($chunk) ? ltrim((string) ($chunk['file'] ?? ''), './') : '';
    }

    public static function asset_url(string $relative_path): string {
        return KODETY_URL . 'assets/' . $relative_path;
    }
}
